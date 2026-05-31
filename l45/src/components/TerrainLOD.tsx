import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '../store/simulationStore';
import { getSimulationManager } from '../ecs/SimulationManager';
import { MATERIAL_PROPERTIES, type TerrainMaterialType } from '../systems/ErosionSystem';

interface TerrainChunkProps {
  lodLevel: number;
  resolution: number;
  size: number;
}

function TerrainChunk({ lodLevel, resolution, size }: TerrainChunkProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const colorsRef = useRef<Float32Array | null>(null);
  const simulation = getSimulationManager();
  const showWireframe = useSimulationStore((state) => state.showTerrainWireframe);

  const { geometry, material } = useMemo(() => {
    const chunkResolution = Math.max(8, Math.floor(resolution / Math.pow(2, lodLevel)));
    const geo = new THREE.PlaneGeometry(size, size, chunkResolution - 1, chunkResolution - 1);
    geo.rotateX(-Math.PI / 2);

    const colors = new Float32Array(geo.attributes.position.count * 3);
    colorsRef.current = colors;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      wireframe: showWireframe,
      side: THREE.DoubleSide,
      metalness: 0.1,
      roughness: 0.8,
    });

    return { geometry: geo, material: mat };
  }, [lodLevel, resolution, size, showWireframe]);

  useFrame(() => {
    if (!meshRef.current || !colorsRef.current) return;

    const positions = geometry.attributes.position;
    const colors = colorsRef.current;
    const heightMap = simulation.getHeightMap();
    const sedimentMap = simulation.getSedimentMap();
    const materialMap = simulation.getMaterialMap();
    const sourceResolution = simulation.getTerrainResolution();
    const chunkResolution = Math.max(8, Math.floor(resolution / Math.pow(2, lodLevel)));

    for (let z = 0; z < chunkResolution; z++) {
      for (let x = 0; x < chunkResolution; x++) {
        const idx = z * chunkResolution + x;
        const sourceX = Math.floor((x / chunkResolution) * sourceResolution);
        const sourceZ = Math.floor((z / chunkResolution) * sourceResolution);
        const sourceIdx = sourceZ * sourceResolution + sourceX;

        const height = heightMap[sourceIdx];
        const sediment = sedimentMap[sourceIdx];
        const materialType = materialMap[sourceIdx] as TerrainMaterialType;
        const materialProps = MATERIAL_PROPERTIES[materialType];

        positions.setY(idx, height);

        let r = materialProps.color.r;
        let g = materialProps.color.g;
        let b = materialProps.color.b;

        const normalizedHeight = Math.min(Math.max(height * 1.5, 0), 1);
        r = r * 0.7 + normalizedHeight * 0.3;
        g = g * 0.8 + normalizedHeight * 0.2;

        if (sediment > 0.01) {
          const sedimentFactor = Math.min(sediment * 5, 1);
          r = r * (1 - sedimentFactor) + 0.8 * sedimentFactor;
          g = g * (1 - sedimentFactor) + 0.7 * sedimentFactor;
          b = b * (1 - sedimentFactor) + 0.55 * sedimentFactor;
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

export function TerrainLOD() {
  const simulation = getSimulationManager();
  const resolution = simulation.getTerrainResolution();
  const size = simulation.getTerrainSize();
  const { camera } = useThree();
  const [activeLOD, setActiveLOD] = useState(0);

  const lodLevels = [
    { distance: 10, level: 0 },
    { distance: 15, level: 1 },
    { distance: 25, level: 2 },
  ];

  useFrame(() => {
    const distance = camera.position.length();
    let newLOD = 0;
    for (let i = lodLevels.length - 1; i >= 0; i--) {
      if (distance > lodLevels[i].distance) {
        newLOD = lodLevels[i].level;
        break;
      }
    }
    if (newLOD !== activeLOD) {
      setActiveLOD(newLOD);
    }
  });

  return (
    <group>
      {lodLevels.map(({ level }) => (
        level === activeLOD && (
          <TerrainChunk
            key={level}
            lodLevel={level}
            resolution={resolution}
            size={size}
          />
        )
      ))}
    </group>
  );
}
