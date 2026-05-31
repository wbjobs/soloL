import { Point3D, BezierControlPoints, WellTrajectory } from '../../shared/types';

export function cubicBezier(
  p0: Point3D, 
  p1: Point3D, 
  p2: Point3D, 
  p3: Point3D, 
  t: number
): Point3D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
    z: mt3 * p0.z + 3 * mt2 * t * p1.z + 3 * mt * t2 * p2.z + t3 * p3.z
  };
}

export function cubicBezierDerivative(
  p0: Point3D, 
  p1: Point3D, 
  p2: Point3D, 
  p3: Point3D, 
  t: number
): Point3D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  
  return {
    x: 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x),
    y: 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y),
    z: 3 * mt2 * (p1.z - p0.z) + 6 * mt * t * (p2.z - p1.z) + 3 * t2 * (p3.z - p2.z)
  };
}

export function sampleTrajectory(trajectory: WellTrajectory, samplesPerSegment: number = 200): Point3D[] {
  const points: Point3D[] = [];
  
  for (const segment of trajectory.segments) {
    for (let i = 0; i <= samplesPerSegment; i++) {
      const t = i / samplesPerSegment;
      points.push(cubicBezier(segment.p0, segment.p1, segment.p2, segment.p3, t));
    }
  }
  
  return points;
}

export function normalize(v: Point3D): Point3D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function cross(a: Point3D, b: Point3D): Point3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

export function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function subtract(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Point3D, b: Point3D): Point3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function multiplyScalar(v: Point3D, s: number): Point3D {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function distance(a: Point3D, b: Point3D): number {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) + 
    Math.pow(a.y - b.y, 2) + 
    Math.pow(a.z - b.z, 2)
  );
}

export function calculateTrajectoryLength(points: Point3D[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += distance(points[i - 1], points[i]);
  }
  return length;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255
      }
    : { r: 0.5, g: 0.5, b: 0.5 };
}

export function generatePlaneVectors(normal: Point3D): { right: Point3D; up: Point3D } {
  const n = normalize(normal);
  const up = { x: 0, y: 0, z: 1 };
  let right = cross(n, up);
  
  if (Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z) < 0.01) {
    right = cross(n, { x: 1, y: 0, z: 0 });
  }
  
  right = normalize(right);
  const trueUp = normalize(cross(right, n));
  
  return { right, up: trueUp };
}
