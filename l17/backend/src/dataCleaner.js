const config = require('./config');

class DataCleaner {
  constructor() {
    this.pupilMinDiameter = config.processing.pupilMinDiameter;
    this.screenWidth = config.screen.width;
    this.screenHeight = config.screen.height;
  }

  clean(dataPoint) {
    if (!this.validateStructure(dataPoint)) {
      return null;
    }

    if (!this.validateCoordinates(dataPoint.x, dataPoint.y)) {
      return null;
    }

    if (!this.validatePupilDiameter(dataPoint.pupilDiameter)) {
      return null;
    }

    return {
      x: dataPoint.x,
      y: dataPoint.y,
      pupilDiameter: dataPoint.pupilDiameter,
      timestamp: dataPoint.timestamp || Date.now()
    };
  }

  validateStructure(dataPoint) {
    return (
      dataPoint &&
      typeof dataPoint.x === 'number' &&
      typeof dataPoint.y === 'number' &&
      typeof dataPoint.pupilDiameter === 'number'
    );
  }

  validateCoordinates(x, y) {
    return (
      !isNaN(x) &&
      !isNaN(y) &&
      x >= 0 &&
      x <= this.screenWidth &&
      y >= 0 &&
      y <= this.screenHeight
    );
  }

  validatePupilDiameter(diameter) {
    return !isNaN(diameter) && diameter >= this.pupilMinDiameter;
  }

  cleanBatch(dataPoints) {
    return dataPoints
      .map(point => this.clean(point))
      .filter(point => point !== null);
  }
}

module.exports = DataCleaner;
