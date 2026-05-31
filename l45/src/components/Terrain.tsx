import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '../store/simulationStore';
import { getSimulationManager } from '../ecs/SimulationManager';

export function Terrain() {
  const meshRef = useRef<THREE.Mesh>(null);
  const colorsRef = useRef<Float32Array | null>(null);
  const showWireframe = useSimulationStore((state) => state.showTerrainWireframe);
  const simulation = getSimulationManager();

  const geometry = useMemo(() => {
    const resolution = simulation.getTerrainResolution();
    const size = simulation.getTerrainSize();
    const geo = new THREE.PlaneGeometry(size, size, resolution - 1, resolution - 1);
    geo.rotateX(-Math.PI / 2);
    
    const colors = new Float32Array(geo.attributes.position.count * 3);
    colorsRef.current = colors;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    return geo;
  }, []);

  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      wireframe: showWireframe,
      side: THREE.DoubleSide,
      metalness: 0.1,
      roughness: 0.8,
    });
  }, [showWireframe]);

  useFrame(() => {
    if (!meshRef.current || !colorsRef.current) return;

    const positions = geometry.attributes.position;
    const colors = colorsRef.current;
    const heightMap = simulation.getHeightMap();
    const sedimentMap = simulation.getSedimentMap();
    const resolution = simulation.getTerrainResolution();

    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const idx = z * resolution + x;
        const height = heightMap[idx];
        const sediment = sedimentMap[idx];

        positions.setY(idx, height);

        const normalizedHeight = Math.min(Math.max(height * 1.5, 0), 1);
        let r = 0.3 + normalizedHeight * 0.3;
        let g = 0.5 + normalizedHeight * 0.2;
        let b = 0.2 + normalizedHeight * 0.1;

        if (sediment > 0.01) {
          const sedimentFactor = Math.min(sediment * 5, 1);
          r = r * (1 - sedimentFactor) + 0.8 * sedimentFactor;
          g = g * (1 - sedimentFactor) + 0.7 * sedimentFactor;
          b = b * (1 - sedimentFactor) + 0.5 * sedimentFactor;
        }

        colors[idx * 3] = r;
        colors[idx * 3 + 1] = g;
        colors[idx * 3 + 2] = b;
      }
    }

    positions.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  useEffect(() => {
    material.wireframe = showWireframe;
  }, [showWireframe, material]);

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} receiveShadow castShadow />
  );
}
