const EventEmitter = require('events');

class AOIAnalyzer extends EventEmitter {
  constructor() {
    super();
  }

  isPointInAOI(point, aoi) {
    const { x, y } = point;
    const { type, x: aoiX, y: aoiY, width, height, radius, points } = aoi;

    switch (type) {
      case 'rectangle':
        return x >= aoiX && x <= aoiX + width && y >= aoiY && y <= aoiY + height;
      
      case 'circle':
        const dx = x - aoiX;
        const dy = y - aoiY;
        return Math.sqrt(dx * dx + dy * dy) <= radius;
      
      case 'polygon':
        return this.isPointInPolygon(x, y, points);
      
      default:
        return false;
    }
  }

  isPointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  analyze(dataPoints, aois) {
    const results = {};

    aois.forEach(aoi => {
      results[aoi.id] = this.analyzeSingleAOI(dataPoints, aoi);
    });

    return results;
  }

  analyzeSingleAOI(dataPoints, aoi) {
    let firstEntryTime = null;
    let totalDuration = 0;
    let revisitCount = 0;
    let isInside = false;
    let entryTime = null;
    let entryPoints = [];
    let exitPoints = [];
    let pointsInside = [];

    for (let i = 0; i < dataPoints.length; i++) {
      const point = dataPoints[i];
      const pointInAOI = this.isPointInAOI(point, aoi);

      if (pointInAOI) {
        pointsInside.push(point);
        
        if (!isInside) {
          isInside = true;
          entryTime = point.timestamp;
          entryPoints.push({
            timestamp: point.timestamp,
            x: point.x,
            y: point.y
          });

          if (firstEntryTime === null) {
            firstEntryTime = point.timestamp;
          } else {
            revisitCount++;
          }
        }
      } else {
        if (isInside) {
          isInside = false;
          if (entryTime !== null) {
            const duration = point.timestamp - entryTime;
            totalDuration += duration;
            exitPoints.push({
              timestamp: point.timestamp,
              duration,
              x: point.x,
              y: point.y
            });
            entryTime = null;
          }
        }
      }
    }

    if (isInside && entryTime !== null) {
      const lastPoint = dataPoints[dataPoints.length - 1];
      const duration = lastPoint.timestamp - entryTime;
      totalDuration += duration;
      exitPoints.push({
        timestamp: lastPoint.timestamp,
        duration,
        x: lastPoint.x,
        y: lastPoint.y
      });
    }

    const totalFixations = revisitCount + (firstEntryTime !== null ? 1 : 0);
    const avgFixationDuration = totalFixations > 0 ? totalDuration / totalFixations : 0;

    let pupilDiameterAvg = null;
    if (pointsInside.length > 0) {
      const sumPupil = pointsInside.reduce((sum, p) => sum + p.pupilDiameter, 0);
      pupilDiameterAvg = sumPupil / pointsInside.length;
    }

    return {
      aoiId: aoi.id,
      aoiName: aoi.name,
      firstEntryTime,
      totalDuration,
      totalFixations,
      revisitCount,
      avgFixationDuration,
      pointsInsideCount: pointsInside.length,
      pupilDiameterAvg,
      entryPoints,
      exitPoints,
      dwellTimePercentage: dataPoints.length > 0 
        ? (pointsInside.length / dataPoints.length) * 100 
        : 0
    };
  }

  generateScanPath(dataPoints, aois) {
    const scanPath = [];
    let currentAOI = null;

    dataPoints.forEach((point, index) => {
      let foundAOI = null;
      
      for (const aoi of aois) {
        if (this.isPointInAOI(point, aoi)) {
          foundAOI = aoi;
          break;
        }
      }

      if (foundAOI && foundAOI.id !== currentAOI) {
        scanPath.push({
          aoiId: foundAOI.id,
          aoiName: foundAOI.name,
          timestamp: point.timestamp,
          x: point.x,
          y: point.y,
          index
        });
        currentAOI = foundAOI.id;
      } else if (!foundAOI && currentAOI !== null) {
        currentAOI = null;
      }
    });

    return scanPath;
  }

  calculateTransitionMatrix(dataPoints, aois) {
    const matrix = {};
    const aoiIds = aois.map(a => a.id);
    
    aoiIds.forEach(fromId => {
      matrix[fromId] = {};
      aoiIds.forEach(toId => {
        matrix[fromId][toId] = 0;
      });
      matrix[fromId]['other'] = 0;
    });
    matrix['other'] = {};
    aoiIds.forEach(toId => {
      matrix['other'][toId] = 0;
    });
    matrix['other']['other'] = 0;

    let prevAOI = null;

    dataPoints.forEach((point) => {
      let currentAOI = 'other';
      
      for (const aoi of aois) {
        if (this.isPointInAOI(point, aoi)) {
          currentAOI = aoi.id;
          break;
        }
      }

      if (prevAOI !== null && prevAOI !== currentAOI) {
        matrix[prevAOI][currentAOI]++;
      }
      
      prevAOI = currentAOI;
    });

    return matrix;
  }
}

module.exports = AOIAnalyzer;
