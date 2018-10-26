var makerjs = require('makerjs');
var meapi = require('makerjs-easel-api');

var repeatTypes = [
  'Spacing',
  'Number of holes'
];

var getSelectedVolumes = function(volumes, selectedVolumeIds){
  return volumes.filter(function(volume){
    return selectedVolumeIds.indexOf(volume.id) >= 0;
  });
};

var getModelsFromPoints = function(shape){
  let models = [];
  for (var x=0; x < shape.points.length; x++){
    let testShape = JSON.parse(JSON.stringify(shape));
    testShape.points.splice(x,1);
    testShape.points.unshift(shape.points[x]);
    let model = meapi.importEaselShape(testShape);
    
    var m1 = makerjs.measure.modelExtents(model);
    if (m1.width > testShape.width) {
      let scale = testShape.width / m1.width;
      makerjs.model.scale(model, scale);
    }
    makerjs.model.center(model, true, true);
    makerjs.model.moveRelative(model, [shape.center.x, shape.center.y]);
    //Keep only the first model
    model.models = { 0: model.models[0] };
    models.push(model);
  }
  return models;
}

var getModel = function(selectedVolume){
  let models = [];
  let shape = selectedVolume.shape;
  if (shape.type == 'path' && shape.points.length > 1){
    models = models.concat(getModelsFromPoints(shape));
  }
  else if (shape.type == 'text'){
    models = models.concat(getModelsFromPoints(shape.fontPath));
  }
  else {
    var model = meapi.importEaselShape(selectedVolume.shape);
    var m1 = makerjs.measure.modelExtents(model);
    if (selectedVolume.shape.width > m1.width) {
      var scale = selectedVolume.shape.width / m1.width;
      makerjs.model.scale(model, scale);
    }
    makerjs.model.center(model, true, true);
    makerjs.model.moveRelative(model, [selectedVolume.shape.center.x, selectedVolume.shape.center.y]);
    models.push(model);
  }
  return models;
};

var getChain = function(selectedVolume){
  var models = getModel(selectedVolume);
  //console.log('getChain', models);
  return models.map(function(model){
    var chain = makerjs.model.findSingleChain(model);
    return chain;
  });
};

var getPoints = function(selectedVolume, repeatType, minimumSpacing, numberOfHoles){
  var chains = getChain(selectedVolume);
  //console.log('getPoints() chains', chains);
  return chains.map(function(chain){
    var keyPoints = [];
    var divisions;
    if (chain){
      divisions = Math.floor(chain.pathLength / minimumSpacing);
      var spacing = chain.pathLength / divisions;
      if (repeatType === repeatTypes[1]){
          spacing = chain.pathLength / numberOfHoles;
      }
      keyPoints = makerjs.chain.toPoints(chain, spacing);
    }
    else {
      // try to get from path?
      var model = getModel(selectedVolume);
      var path = model.models[0].paths.ShapeLine1;
      makerjs.path.center(path, true, true);
      makerjs.path.moveRelative(path, [selectedVolume.shape.center.x, selectedVolume.shape.center.y]);
      var pathLength = makerjs.measure.modelPathLength(model);
      divisions = Math.floor(pathLength / minimumSpacing);
      if (repeatType === repeatTypes[1]){
          divisions = numberOfHoles;
      }
      keyPoints = makerjs.path.toPoints(path, divisions);
    }
  
    return keyPoints;
  });
};

// Define a properties array that returns array of objects representing
// the accepted properties for your application
var properties = function(projectSettings){
  var bitSize = projectSettings.bitParams.bit.width;
  if (projectSettings.bitParams.bit.unit === 'mm') { bitSize /= 25.4; }

  var minValue = bitSize * 3;
  var bitValue = bitSize + 0.001;

  var defaults = {
    'Hole Size': bitValue,
    'Spacing': minValue,
    'Depth': 0.0625
  };

  if (projectSettings.preferredUnit === 'mm'){
    defaults['Hole Size'] *= 25.4;
    defaults['Spacing'] *= 25.4;
    defaults['Depth'] *= 25.4;
  }

  return [
    { type: 'text', id: 'Hole Size', value: defaults['Hole Size'] },
    { type: 'text', id: 'Depth', value: defaults['Depth'] },
    { type: 'list', id: 'Repeat Type', value: 'Spacing', options: repeatTypes },
    { type: 'text', id: 'Spacing', value: defaults['Spacing'] },
    { type: 'text', id: 'Number of holes', value: 4 },
    { type: 'boolean', id: 'Use Drill Points', value: false }
  ];
};

// Define an executor function that builds an array of volumes,
// and passes it to the provided success callback, or invokes the failure
// callback if unable to do so
var executor = function(args, success, failure) {
  //console.log(args);
  var params = args.params;
  var material = args.material;

  var useDrillPoints = params['Use Drill Points'];
  var bitSize = args.bitParams.bit.width;
  if (args.bitParams.bit.unit === 'mm') { bitSize /= 25.4; }

  var size = parseFloat(params['Hole Size']);
  if (isNaN(size) || size < 0){ return failure('Hole Size is not valid'); }
  if (size < bitSize) { return failure('Hole Size is too small for current bit'); }
  if (size == bitSize){ size += 0.001; }

  var repeatType = params['Repeat Type'];

  var minimumSpacing = parseFloat(params['Spacing']);
  if (repeatType == repeatTypes[0]){
    if (isNaN(minimumSpacing) || minimumSpacing < 0){ 
      return failure('Spacing is not valid');
    }
    if (minimumSpacing < bitSize){
      //Show Error?
      return failure('Spacing is not valid');
    }
  }

  var numberOfHoles = parseInt(params['Number of holes']);
  if (repeatType == repeatTypes[1] && (isNaN(numberOfHoles) || numberOfHoles < 0)){ 
    return failure('Number of holes is not valid');
  }

  var depth = parseFloat(params['Depth']);

  if (args.preferredUnit === 'mm'){
    size /= 25.4;
    minimumSpacing /= 25.4;
    depth /= 25.4;
  }

  var newVolumes = [];
  var selectedVolumes = getSelectedVolumes(args.volumes, args.selectedVolumeIds);

  //if (selectedVolumes.filter(function(x){ return x.shape.type == 'text'; }).length > 0){
  //  return failure('Please use the Xploder app on text first.'); 
  //}

  selectedVolumes.forEach(function(selectedVolume){
    var keyPoints1 = getPoints(selectedVolume, repeatType, minimumSpacing, numberOfHoles);
    
    keyPoints1.map(function(keyPoints){
      if (!keyPoints || keyPoints.length <= 0) { return; }
      var dots = new makerjs.models.Holes(size, keyPoints);
      for (var pathId in dots.paths) {
        var path = dots.paths[pathId];
        if (useDrillPoints){
          newVolumes.push({
            shape: {
                type: 'drill',
                center: {
                  x: path.origin[0],
                  y: path.origin[1]
                },
                flipping: {},
                width: bitSize,
                height: bitSize,
                rotation: 0
            },
            cut: {
               type: 'drill',
               depth: depth,
               outlineStyle: 'on-path',
               tabPreference: false
            }
          });
        }
        else {
          newVolumes.push({
            shape: {
              type: "ellipse",
              center: {
                x: path.origin[0],
                y: path.origin[1]
              },
              flipping: {},
              width: path.radius * 2,
              height: path.radius * 2,
              rotation: 0
            },
            cut: {
              depth: depth,
              type: 'fill',
              tabPreference: false
            }
          });
        }
      };
    });
  });
  
  //console.log('newVolumes', newVolumes);

  if (newVolumes.length > 0){
    return success(newVolumes);
  }
  else {
    return failure('Not able to find points');
  }

};
