export const gridShader = `
struct Params {
  particlesPerBlock: f32,
  gridSize: f32,
  invGridSize: f32,
  gridResolution: u32,
  smoothingRadius: f32,
  restDensity: f32,
  stiffness: f32,
  viscosity: f32,
  gravity: f32,
  timeStep: f32,
  damping: f32,
  boundarySize: f32,
  maxParticlesPerCell: u32,
  totalParticles: u32,
  padding0: u32,
  padding1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> gridCounts: array<u32>;

fn getGridCell(pos: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(
    i32(floor(pos.x * params.invGridSize)),
    i32(floor(pos.y * params.invGridSize)),
    i32(floor(pos.z * params.invGridSize))
  );
}

fn getGridIndex(cell: vec3<i32>) -> u32 {
  let res = i32(params.gridResolution);
  let c = vec3<i32>(
    clamp(cell.x, 0, res - 1),
    clamp(cell.y, 0, res - 1),
    clamp(cell.z, 0, res - 1)
  );
  return u32(c.x + c.y * res + c.z * res * res);
}

@compute @workgroup_size(256)
fn clearGrid(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  if (idx >= arrayLength(&gridCounts)) { return; }
  gridCounts[idx] = 0u;
}

@compute @workgroup_size(256)
fn countParticles(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  let blockSize = arrayLength(&positions);
  if (idx >= blockSize) { return; }
  
  let pos = positions[idx].xyz;
  let cell = getGridCell(pos);
  let gridIdx = getGridIndex(cell);
  
  atomicAdd(&gridCounts[gridIdx], 1u);
}
`;

export const sortShader = `
struct Params {
  particlesPerBlock: f32,
  gridSize: f32,
  invGridSize: f32,
  gridResolution: u32,
  smoothingRadius: f32,
  restDensity: f32,
  stiffness: f32,
  viscosity: f32,
  gravity: f32,
  timeStep: f32,
  damping: f32,
  boundarySize: f32,
  maxParticlesPerCell: u32,
  totalParticles: u32,
  padding0: u32,
  padding1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> gridCells: array<u32>;
@group(0) @binding(3) var<storage, read_write> gridOffsets: array<u32>;

fn getGridCell(pos: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(
    i32(floor(pos.x * params.invGridSize)),
    i32(floor(pos.y * params.invGridSize)),
    i32(floor(pos.z * params.invGridSize))
  );
}

fn getGridIndex(cell: vec3<i32>) -> u32 {
  let res = i32(params.gridResolution);
  let c = vec3<i32>(
    clamp(cell.x, 0, res - 1),
    clamp(cell.y, 0, res - 1),
    clamp(cell.z, 0, res - 1)
  );
  return u32(c.x + c.y * res + c.z * res * res);
}

@compute @workgroup_size(256)
fn sortParticles(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  let blockSize = arrayLength(&positions);
  if (idx >= blockSize) { return; }
  
  let pos = positions[idx].xyz;
  let cell = getGridCell(pos);
  let gridIdx = getGridIndex(cell);
  
  let cellOffset = atomicAdd(&gridOffsets[gridIdx], 1u);
  let maxPerCell = params.maxParticlesPerCell;
  
  if (cellOffset < maxPerCell) {
    gridCells[gridIdx * maxPerCell + cellOffset] = idx;
  }
}
`;

export const densityShader = `
struct Params {
  particlesPerBlock: f32,
  gridSize: f32,
  invGridSize: f32,
  gridResolution: u32,
  smoothingRadius: f32,
  restDensity: f32,
  stiffness: f32,
  viscosity: f32,
  gravity: f32,
  timeStep: f32,
  damping: f32,
  boundarySize: f32,
  maxParticlesPerCell: u32,
  totalParticles: u32,
  padding0: u32,
  padding1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> densities: array<f32>;
@group(0) @binding(3) var<storage, read> gridCells: array<u32>;
@group(0) @binding(4) var<storage, read> gridCounts: array<u32>;

const PI: f32 = 3.14159265359;

fn poly6Kernel(r: f32, h: f32) -> f32 {
  if (r > h) { return 0.0; }
  let h2 = h * h;
  let r2 = r * r;
  let diff = h2 - r2;
  return (315.0 / (64.0 * PI * pow(h, 9.0))) * diff * diff * diff;
}

fn getGridCell(pos: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(
    i32(floor(pos.x * params.invGridSize)),
    i32(floor(pos.y * params.invGridSize)),
    i32(floor(pos.z * params.invGridSize))
  );
}

fn getGridIndex(cell: vec3<i32>) -> u32 {
  let res = i32(params.gridResolution);
  let c = vec3<i32>(
    clamp(cell.x, 0, res - 1),
    clamp(cell.y, 0, res - 1),
    clamp(cell.z, 0, res - 1)
  );
  return u32(c.x + c.y * res + c.z * res * res);
}

@compute @workgroup_size(256)
fn computeDensity(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  let blockSize = arrayLength(&positions);
  if (idx >= blockSize) { return; }
  
  let pos = positions[idx].xyz;
  let cell = getGridCell(pos);
  let h = params.smoothingRadius;
  let h2 = h * h;
  var density = 0.0;
  let maxPerCell = params.maxParticlesPerCell;
  
  for (var z: i32 = -1; z <= 1; z++) {
    for (var y: i32 = -1; y <= 1; y++) {
      for (var x: i32 = -1; x <= 1; x++) {
        let neighborCell = cell + vec3<i32>(x, y, z);
        let gridIdx = getGridIndex(neighborCell);
        let count = min(gridCounts[gridIdx], maxPerCell);
        
        for (var j: u32 = 0u; j < count; j++) {
          let otherIdx = gridCells[gridIdx * maxPerCell + j];
          let otherPos = positions[otherIdx].xyz;
          
          let diff = pos - otherPos;
          let r2 = dot(diff, diff);
          
          if (r2 < h2) {
            density += poly6Kernel(sqrt(r2), h);
          }
        }
      }
    }
  }
  
  densities[idx] = density * 1.0;
}
`;

export const forceShader = `
struct Params {
  particlesPerBlock: f32,
  gridSize: f32,
  invGridSize: f32,
  gridResolution: u32,
  smoothingRadius: f32,
  restDensity: f32,
  stiffness: f32,
  viscosity: f32,
  gravity: f32,
  timeStep: f32,
  damping: f32,
  boundarySize: f32,
  maxParticlesPerCell: u32,
  totalParticles: u32,
  padding0: u32,
  padding1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> densities: array<f32>;
@group(0) @binding(4) var<storage, read_write> forces: array<vec3<f32>>;
@group(0) @binding(5) var<storage, read> gridCells: array<u32>;
@group(0) @binding(6) var<storage, read> gridCounts: array<u32>;

const PI: f32 = 3.14159265359;

fn spikyKernelGrad(r: f32, h: f32, dir: vec3<f32>) -> vec3<f32> {
  if (r > h || r < 0.0001) { return vec3<f32>(0.0); }
  let diff = h - r;
  let coeff = -45.0 / (PI * pow(h, 6.0)) * diff * diff;
  return dir * (coeff / r);
}

fn viscosityKernelLaplacian(r: f32, h: f32) -> f32 {
  if (r > h) { return 0.0; }
  return (45.0 / (PI * pow(h, 6.0))) * (h - r);
}

fn getGridCell(pos: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(
    i32(floor(pos.x * params.invGridSize)),
    i32(floor(pos.y * params.invGridSize)),
    i32(floor(pos.z * params.invGridSize))
  );
}

fn getGridIndex(cell: vec3<i32>) -> u32 {
  let res = i32(params.gridResolution);
  let c = vec3<i32>(
    clamp(cell.x, 0, res - 1),
    clamp(cell.y, 0, res - 1),
    clamp(cell.z, 0, res - 1)
  );
  return u32(c.x + c.y * res + c.z * res * res);
}

@compute @workgroup_size(256)
fn computeForces(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  let blockSize = arrayLength(&positions);
  if (idx >= blockSize) { return; }
  
  let pos = positions[idx].xyz;
  let vel = velocities[idx].xyz;
  let rho_i = max(densities[idx], params.restDensity * 0.5);
  let p_i = params.stiffness * (rho_i - params.restDensity);
  
  let cell = getGridCell(pos);
  let h = params.smoothingRadius;
  let h2 = h * h;
  let maxPerCell = params.maxParticlesPerCell;
  
  var pressureForce = vec3<f32>(0.0);
  var viscosityForce = vec3<f32>(0.0);
  
  for (var z: i32 = -1; z <= 1; z++) {
    for (var y: i32 = -1; y <= 1; y++) {
      for (var x: i32 = -1; x <= 1; x++) {
        let neighborCell = cell + vec3<i32>(x, y, z);
        let gridIdx = getGridIndex(neighborCell);
        let count = min(gridCounts[gridIdx], maxPerCell);
        
        for (var j: u32 = 0u; j < count; j++) {
          let otherIdx = gridCells[gridIdx * maxPerCell + j];
          if (otherIdx == idx) { continue; }
          
          let otherPos = positions[otherIdx].xyz;
          let otherVel = velocities[otherIdx].xyz;
          let rho_j = max(densities[otherIdx], params.restDensity * 0.5);
          let p_j = params.stiffness * (rho_j - params.restDensity);
          
          let diff = pos - otherPos;
          let r2 = dot(diff, diff);
          
          if (r2 < h2 && r2 > 0.000001) {
            let r = sqrt(r2);
            let dir = diff / r;
            
            pressureForce += spikyKernelGrad(r, h, dir) * (p_i + p_j) / (2.0 * rho_j);
            viscosityForce += viscosityKernelLaplacian(r, h) * (otherVel - vel) / rho_j;
          }
        }
      }
    }
  }
  
  pressureForce *= -1.0;
  viscosityForce *= params.viscosity;
  
  let gravityForce = vec3<f32>(0.0, params.gravity * rho_i, 0.0);
  
  forces[idx] = pressureForce + viscosityForce + gravityForce;
}
`;

export const integrateShader = `
struct Params {
  particlesPerBlock: f32,
  gridSize: f32,
  invGridSize: f32,
  gridResolution: u32,
  smoothingRadius: f32,
  restDensity: f32,
  stiffness: f32,
  viscosity: f32,
  gravity: f32,
  timeStep: f32,
  damping: f32,
  boundarySize: f32,
  maxParticlesPerCell: u32,
  totalParticles: u32,
  obstacleCount: u32,
  padding1: u32,
};

struct Obstacle {
  type: f32,
  posX: f32,
  posY: f32,
  posZ: f32,
  rotX: f32,
  rotY: f32,
  rotZ: f32,
  scaleX: f32,
  scaleY: f32,
  scaleZ: f32,
  invMass: f32,
  padding: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> forces: array<vec3<f32>>;
@group(0) @binding(4) var<storage, read_write> newPositions: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> newVelocities: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> densities: array<f32>;
@group(0) @binding(7) var<storage, read> obstacles: array<Obstacle>;

fn rotateInverse(v: vec3<f32>, rx: f32, ry: f32, rz: f32) -> vec3<f32> {
  let cx = cos(-rx);
  let sx = sin(-rx);
  let cy = cos(-ry);
  let sy = sin(-ry);
  let cz = cos(-rz);
  let sz = sin(-rz);
  
  let rotX = vec3<f32>(1.0, 0.0, 0.0);
  let rotY = vec3<f32>(0.0, cx, sx);
  let rotZ = vec3<f32>(0.0, -sx, cx);
  
  var result = vec3<f32>(
    dot(rotX, v),
    dot(rotY, v),
    dot(rotZ, v)
  );
  
  let rot2X = vec3<f32>(cy, 0.0, -sy);
  let rot2Y = vec3<f32>(0.0, 1.0, 0.0);
  let rot2Z = vec3<f32>(sy, 0.0, cy);
  
  result = vec3<f32>(
    dot(rot2X, result),
    dot(rot2Y, result),
    dot(rot2Z, result)
  );
  
  let rot3X = vec3<f32>(cz, sz, 0.0);
  let rot3Y = vec3<f32>(-sz, cz, 0.0);
  let rot3Z = vec3<f32>(0.0, 0.0, 1.0);
  
  return vec3<f32>(
    dot(rot3X, result),
    dot(rot3Y, result),
    dot(rot3Z, result)
  );
}

fn pointBoxDistance(
  point: vec3<f32>,
  boxPos: vec3<f32>,
  boxRot: vec3<f32>,
  boxScale: vec3<f32>
) -> vec3<f32> {
  var localPoint = point - boxPos;
  localPoint = rotateInverse(localPoint, boxRot.x, boxRot.y, boxRot.z);
  
  let halfScale = boxScale * 0.5;
  let clamped = clamp(localPoint, -halfScale, halfScale);
  let delta = localPoint - clamped;
  
  let distance = length(delta);
  var normal = normalize(delta);
  if (distance < 0.0001) {
    let absLocal = abs(localPoint);
    let distToFace = halfScale - absLocal;
    var minDist = distToFace.x;
    normal = vec3<f32>(sign(localPoint.x), 0.0, 0.0);
    if (distToFace.y < minDist) {
      minDist = distToFace.y;
      normal = vec3<f32>(0.0, sign(localPoint.y), 0.0);
    }
    if (distToFace.z < minDist) {
      normal = vec3<f32>(0.0, 0.0, sign(localPoint.z));
    }
  }
  
  return vec3<f32>(normal * max(distance, 0.001));
}

fn pointSphereDistance(
  point: vec3<f32>,
  spherePos: vec3<f32>,
  radius: f32
) -> vec3<f32> {
  let delta = point - spherePos;
  let dist = length(delta);
  let normal = select(delta / dist, vec3<f32>(0.0, 1.0, 0.0), dist < 0.0001);
  let penetration = radius - dist;
  return normal * penetration;
}

@compute @workgroup_size(256)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  let blockSize = arrayLength(&positions);
  if (idx >= blockSize) { return; }
  
  let pos = positions[idx].xyz;
  let vel = velocities[idx].xyz;
  let force = forces[idx];
  let rho = max(densities[idx], params.restDensity * 0.5);
  
  var newVel = vel + force / rho * params.timeStep;
  var newPos = pos + newVel * params.timeStep;
  
  let halfBound = params.boundarySize * 0.5;
  let r = 0.015;
  
  if (newPos.x < -halfBound + r) {
    newPos.x = -halfBound + r;
    newVel.x = -newVel.x * params.damping;
  }
  if (newPos.x > halfBound - r) {
    newPos.x = halfBound - r;
    newVel.x = -newVel.x * params.damping;
  }
  if (newPos.y < -halfBound + r) {
    newPos.y = -halfBound + r;
    newVel.y = -newVel.y * params.damping;
  }
  if (newPos.y > halfBound - r) {
    newPos.y = halfBound - r;
    newVel.y = -newVel.y * params.damping;
  }
  if (newPos.z < -halfBound + r) {
    newPos.z = -halfBound + r;
    newVel.z = -newVel.z * params.damping;
  }
  if (newPos.z > halfBound - r) {
    newPos.z = halfBound - r;
    newVel.z = -newVel.z * params.damping;
  }
  
  let obstacleCount = params.obstacleCount;
  for (var o: u32 = 0u; o < obstacleCount; o++) {
    let obs = obstacles[o];
    let obsPos = vec3<f32>(obs.posX, obs.posY, obs.posZ);
    let obsRot = vec3<f32>(obs.rotX, obs.rotY, obs.rotZ);
    let obsScale = vec3<f32>(obs.scaleX, obs.scaleY, obs.scaleZ);
    
    var penetration: vec3<f32>;
    if (obs.type < 0.5) {
      penetration = pointBoxDistance(newPos, obsPos, obsRot, obsScale);
    } else {
      penetration = pointSphereDistance(newPos, obsPos, obsScale.x * 0.5 + r);
    }
    
    let penDepth = length(penetration);
    if (penDepth > 0.0) {
      let normal = penetration / penDepth;
      newPos += normal * penDepth;
      let velAlongNormal = dot(newVel, normal);
      if (velAlongNormal < 0.0) {
        newVel -= normal * velAlongNormal * (1.0 + params.damping);
      }
    }
  }
  
  newPositions[idx] = vec4<f32>(newPos, densities[idx]);
  newVelocities[idx] = vec4<f32>(newVel, length(newVel));
}
`;

export const forceFeedbackShader = `
struct Params {
  particlesPerBlock: f32,
  gridSize: f32,
  invGridSize: f32,
  gridResolution: u32,
  smoothingRadius: f32,
  restDensity: f32,
  stiffness: f32,
  viscosity: f32,
  gravity: f32,
  timeStep: f32,
  damping: f32,
  boundarySize: f32,
  maxParticlesPerCell: u32,
  totalParticles: u32,
  obstacleCount: u32,
  padding1: u32,
};

struct Obstacle {
  type: f32,
  posX: f32,
  posY: f32,
  posZ: f32,
  rotX: f32,
  rotY: f32,
  rotZ: f32,
  scaleX: f32,
  scaleY: f32,
  scaleZ: f32,
  invMass: f32,
  padding: f32,
};

struct ForceFeedback {
  forceX: f32,
  forceY: f32,
  forceZ: f32,
  torqueX: f32,
  torqueY: f32,
  torqueZ: f32,
  padding1: f32,
  padding2: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> densities: array<f32>;
@group(0) @binding(4) var<storage, read> obstacles: array<Obstacle>;
@group(0) @binding(5) var<storage, read_write> feedback: array<ForceFeedback>;

fn rotateInverse(v: vec3<f32>, rx: f32, ry: f32, rz: f32) -> vec3<f32> {
  let cx = cos(-rx);
  let sx = sin(-rx);
  let cy = cos(-ry);
  let sy = sin(-ry);
  let cz = cos(-rz);
  let sz = sin(-rz);
  
  var result = v;
  
  let rot3X = vec3<f32>(cz, sz, 0.0);
  let rot3Y = vec3<f32>(-sz, cz, 0.0);
  let rot3Z = vec3<f32>(0.0, 0.0, 1.0);
  result = vec3<f32>(
    dot(rot3X, result),
    dot(rot3Y, result),
    dot(rot3Z, result)
  );
  
  let rot2X = vec3<f32>(cy, 0.0, -sy);
  let rot2Y = vec3<f32>(0.0, 1.0, 0.0);
  let rot2Z = vec3<f32>(sy, 0.0, cy);
  result = vec3<f32>(
    dot(rot2X, result),
    dot(rot2Y, result),
    dot(rot2Z, result)
  );
  
  let rotX = vec3<f32>(1.0, 0.0, 0.0);
  let rotY = vec3<f32>(0.0, cx, sx);
  let rotZ = vec3<f32>(0.0, -sx, cx);
  return vec3<f32>(
    dot(rotX, result),
    dot(rotY, result),
    dot(rotZ, result)
  );
}

fn cross(a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
  );
}

@compute @workgroup_size(64)
fn computeForceFeedback(@builtin(global_invocation_id) id: vec3<u32>) {
  let particleIdx = id.x;
  let blockSize = arrayLength(&positions);
  if (particleIdx >= blockSize) { return; }
  
  let pos = positions[particleIdx].xyz;
  let vel = velocities[particleIdx].xyz;
  let rho = max(densities[particleIdx], params.restDensity * 0.5);
  let h = params.smoothingRadius;
  
  let obstacleCount = params.obstacleCount;
  let particleMass = 1.0;
  
  for (var o: u32 = 0u; o < obstacleCount; o++) {
    let obs = obstacles[o];
    let obsPos = vec3<f32>(obs.posX, obs.posY, obs.posZ);
    let obsRot = vec3<f32>(obs.rotX, obs.rotY, obs.rotZ);
    let obsScale = vec3<f32>(obs.scaleX, obs.scaleY, obs.scaleZ);
    
    let toParticle = pos - obsPos;
    let localPos = rotateInverse(toParticle, obsRot.x, obsRot.y, obsRot.z);
    let halfScale = obsScale * 0.5;
    let clamped = clamp(localPos, -halfScale, halfScale);
    
    var isInside = false;
    var closestPoint = clamped;
    var penetrationDepth = 0.0;
    
    if (obs.type < 0.5) {
      let delta = localPos - clamped;
      let dist = length(delta);
      isInside = dist < h;
      penetrationDepth = max(h - dist, 0.0);
      closestPoint = clamped;
    } else {
      let radius = obsScale.x * 0.5;
      let dist = length(localPos);
      isInside = dist < radius + h;
      penetrationDepth = max(radius + h - dist, 0.0);
      if (dist > 0.001) {
        closestPoint = localPos * (radius / dist);
      }
    }
    
    if (isInside && penetrationDepth > 0.0) {
      let pressure = params.stiffness * (rho - params.restDensity);
      let normal = normalize(pos - (obsPos + closestPoint));
      
      let forceMag = pressure * penetrationDepth * penetrationDepth * 3.14159;
      var force = normal * forceMag;
      
      let viscousForce = -vel * params.viscosity * 0.01;
      force += viscousForce;
      
      let torque = cross(toParticle, force) * 0.1;
      
      atomicAdd(&feedback[o].forceX, -force.x * particleMass);
      atomicAdd(&feedback[o].forceY, -force.y * particleMass);
      atomicAdd(&feedback[o].forceZ, -force.z * particleMass);
      atomicAdd(&feedback[o].torqueX, torque.x * particleMass);
      atomicAdd(&feedback[o].torqueY, torque.y * particleMass);
      atomicAdd(&feedback[o].torqueZ, torque.z * particleMass);
    }
  }
}
`;
