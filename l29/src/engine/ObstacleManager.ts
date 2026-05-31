import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export type ObstacleType = 'box' | 'sphere';

export interface ObstacleData {
  id: string;
  type: ObstacleType;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  isStatic: boolean;
  mass: number;
  restitution: number;
  friction: number;
  color: number;
}

export interface ObstacleGPUData {
  type: number;
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  invMass: number;
  padding: number;
}

export interface FluidForceFeedback {
  obstacleId: string;
  force: THREE.Vector3;
  torque: THREE.Vector3;
}

export class ObstacleManager {
  private obstacles: Map<string, {
    data: ObstacleData;
    mesh: THREE.Mesh;
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
  }> = new Map();

  private scene: THREE.Scene;
  private physicsWorld: RAPIER.World;
  private maxObstacles: number = 32;

  constructor(scene: THREE.Scene, physicsWorld: RAPIER.World, maxObstacles: number = 32) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.maxObstacles = maxObstacles;
  }

  addObstacle(data: ObstacleData): string | null {
    if (this.obstacles.size >= this.maxObstacles) {
      console.warn('Max obstacles reached');
      return null;
    }

    const id = data.id || `obstacle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    let geometry: THREE.BufferGeometry;
    let colliderDesc: RAPIER.ColliderDesc;
    let bodyDesc: RAPIER.RigidBodyDesc;

    if (data.type === 'box') {
      geometry = new THREE.BoxGeometry(1, 1, 1);
      colliderDesc = RAPIER.ColliderDesc.cuboid(
        data.scale.x * 0.5,
        data.scale.y * 0.5,
        data.scale.z * 0.5
      );
    } else {
      geometry = new THREE.SphereGeometry(1, 16, 12);
      colliderDesc = RAPIER.ColliderDesc.ball(data.scale.x * 0.5);
    }

    geometry.scale(data.scale.x, data.scale.y, data.scale.z);

    const material = new THREE.MeshStandardMaterial({
      color: data.color,
      metalness: 0.3,
      roughness: 0.5,
      transparent: true,
      opacity: 0.9,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(data.position);
    mesh.rotation.copy(data.rotation);
    mesh.userData.obstacleId = id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    this.scene.add(mesh);

    bodyDesc = data.isStatic
      ? RAPIER.RigidBodyDesc.fixed()
      : RAPIER.RigidBodyDesc.dynamic();

    bodyDesc.setTranslation(data.position.x, data.position.y, data.position.z);
    const quat = new THREE.Quaternion().setFromEuler(data.rotation);
    bodyDesc.setRotation({
      x: quat.x,
      y: quat.y,
      z: quat.z,
      w: quat.w,
    });

    const body = this.physicsWorld.createRigidBody(bodyDesc);
    
    colliderDesc.setFriction(data.friction);
    colliderDesc.setRestitution(data.restitution);
    if (!data.isStatic) {
      colliderDesc.setDensity(data.mass / (data.scale.x * data.scale.y * data.scale.z));
    }

    const collider = this.physicsWorld.createCollider(colliderDesc, body);

    this.obstacles.set(id, { data: { ...data, id }, mesh, body, collider });

    return id;
  }

  removeObstacle(id: string): boolean {
    const obstacle = this.obstacles.get(id);
    if (!obstacle) return false;

    this.scene.remove(obstacle.mesh);
    obstacle.mesh.geometry.dispose();
    (obstacle.mesh.material as THREE.Material).dispose();
    this.physicsWorld.removeRigidBody(obstacle.body);

    this.obstacles.delete(id);
    return true;
  }

  getObstacle(id: string): ObstacleData | null {
    const obstacle = this.obstacles.get(id);
    return obstacle ? { ...obstacle.data } : null;
  }

  getAllObstacles(): ObstacleData[] {
    return Array.from(this.obstacles.values()).map((o) => ({ ...o.data }));
  }

  getObstacleMesh(id: string): THREE.Mesh | null {
    return this.obstacles.get(id)?.mesh || null;
  }

  updateFromPhysics(): void {
    for (const { data, mesh, body } of this.obstacles.values()) {
      if (data.isStatic) continue;

      const pos = body.translation();
      const rot = body.rotation();

      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

      data.position.set(pos.x, pos.y, pos.z);
      data.rotation.setFromQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
    }
  }

  applyForceToObstacle(id: string, force: THREE.Vector3, torque: THREE.Vector3): void {
    const obstacle = this.obstacles.get(id);
    if (!obstacle || obstacle.data.isStatic) return;

    obstacle.body.addForce(
      { x: force.x, y: force.y, z: force.z },
      true
    );
    obstacle.body.addTorque(
      { x: torque.x, y: torque.y, z: torque.z },
      true
    );
  }

  getGPUData(): Float32Array {
    const data = new Float32Array(this.maxObstacles * 12);
    let index = 0;

    for (const { data: obstacle } of this.obstacles.values()) {
      const base = index * 12;
      data[base] = obstacle.type === 'box' ? 0 : 1;
      data[base + 1] = obstacle.position.x;
      data[base + 2] = obstacle.position.y;
      data[base + 3] = obstacle.position.z;
      data[base + 4] = obstacle.rotation.x;
      data[base + 5] = obstacle.rotation.y;
      data[base + 6] = obstacle.rotation.z;
      data[base + 7] = obstacle.scale.x;
      data[base + 8] = obstacle.scale.y;
      data[base + 9] = obstacle.scale.z;
      data[base + 10] = obstacle.isStatic ? 0 : 1.0 / obstacle.mass;
      data[base + 11] = 0;
      index++;
    }

    return data;
  }

  getObstacleIdByIndex(index: number): string | null {
    const entries = Array.from(this.obstacles.entries());
    return entries[index]?.[0] || null;
  }

  getObstacleCount(): number {
    return this.obstacles.size;
  }

  getMaxObstacles(): number {
    return this.maxObstacles;
  }

  clearAll(): void {
    for (const id of Array.from(this.obstacles.keys())) {
      this.removeObstacle(id);
    }
  }

  dispose(): void {
    this.clearAll();
  }
}

export function createDefaultObstacleData(
  type: ObstacleType,
  position: THREE.Vector3
): ObstacleData {
  return {
    id: '',
    type,
    position: position.clone(),
    rotation: new THREE.Euler(0, 0, 0),
    scale: new THREE.Vector3(0.4, 0.4, 0.4),
    isStatic: false,
    mass: 10,
    restitution: 0.3,
    friction: 0.5,
    color: type === 'box' ? 0xff8844 : 0x44ff88,
  };
}
