import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '../store/simulationStore';
import { getSimulationManager } from '../ecs/SimulationManager';

const MAX_PARTICLES = 5000;

export function FluidParticles() {
  const pointsRef = useRef<THREE.Points>(null);
  const showParticles = useSimulationStore((state) => state.showParticles);
  const simulation = getSimulationManager();

  const { geometry, material } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -100;
      positions[i * 3 + 2] = 0;
      
      colors[i * 3] = 0.2;
      colors[i * 3 + 1] = 0.6;
      colors[i * 3 + 2] = 1.0;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.08,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    return { geometry: geo, material: mat };
  }, []);

  useFrame(() => {
    if (!pointsRef.current || !showParticles) return;

    const positions = geometry.attributes.position.array as Float32Array;
    const particlePositions = simulation.getParticlePositions();
    const particleCount = simulation.getParticleCount();

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (i < particleCount) {
        positions[i * 3] = particlePositions[i * 3];
        positions[i * 3 + 1] = particlePositions[i * 3 + 1];
        positions[i * 3 + 2] = particlePositions[i * 3 + 2];
      } else {
        positions[i * 3 + 1] = -100;
      }
    }

    geometry.attributes.position.needsUpdate = true;
  });

  if (!showParticles) return null;

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}
