import { useMemo } from 'react';
import * as THREE from 'three';
import { SimulationResult, Grid3D } from '../../../shared/types';

interface FlowSimulationVisualizationProps {
  simulationResult: SimulationResult;
  grid: Grid3D;
  timeStepIndex?: number;
}

export function FlowSimulationVisualization({ 
  simulationResult, 
  grid,
  timeStepIndex = -1
}: FlowSimulationVisualizationProps) {
  const { dimensions, origin, spacing } = grid;
  const { nx, ny, nz } = dimensions;

  const oilSaturationGeometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];

    const saturationData = simulationResult.finalOilSaturation;
    const step = 2;

    for (let iz = 0; iz < nz; iz += step) {
      for (let iy = 0; iy < ny; iy += step) {
        for (let ix = 0; ix < nx; ix += step) {
          const idx = iz * nx * ny + iy * nx + ix;
          const saturation = saturationData[idx];
          
          if (saturation > 0.3) {
            positions.push(
              origin.x + ix * spacing.x,
              origin.y + iy * spacing.y,
              origin.z + iz * spacing.z
            );

            const t = saturation;
            const r = Math.floor(255 * (1 - t));
            const g = Math.floor(255 * (1 - t * 0.5));
            const b = Math.floor(255 * t);
            colors.push(r / 255, g / 255, b / 255);
            
            sizes.push(saturation * 10 + 2);
          }
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

    return geometry;
  }, [simulationResult, grid]);

  const pressureGeometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];

    const pressureData = simulationResult.finalPressureField;
    const step = 3;

    const minPressure = Math.min(...pressureData);
    const maxPressure = Math.max(...pressureData);
    const pressureRange = maxPressure - minPressure || 1;

    for (let iz = 0; iz < nz; iz += step) {
      for (let iy = 0; iy < ny; iy += step) {
        for (let ix = 0; ix < nx; ix += step) {
          const idx = iz * nx * ny + iy * nx + ix;
          const pressure = pressureData[idx];
          
          const normalizedPressure = (pressure - minPressure) / pressureRange;
          
          positions.push(
            origin.x + ix * spacing.x,
            origin.y + iy * spacing.y,
            origin.z + iz * spacing.z
          );

          const r = Math.floor(255 * normalizedPressure);
          const g = Math.floor(255 * (1 - Math.abs(normalizedPressure - 0.5) * 2));
          const b = Math.floor(255 * (1 - normalizedPressure));
          colors.push(r / 255, g / 255, b / 255);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    return geometry;
  }, [simulationResult, grid]);

  const waterOilContactGeometry = useMemo(() => {
    if (simulationResult.waterOilContact.length === 0) return null;

    const contactPoints = simulationResult.waterOilContact[
      timeStepIndex >= 0 
        ? Math.min(timeStepIndex, simulationResult.waterOilContact.length - 1)
        : simulationResult.waterOilContact.length - 1
    ];

    if (contactPoints.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    const positions = contactPoints.flatMap(p => [p.x, p.y, p.z]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    return geometry;
  }, [simulationResult, timeStepIndex]);

  return (
    <group name="flow-simulation">
      <points geometry={oilSaturationGeometry}>
        <pointsMaterial
          size={5}
          vertexColors
          transparent
          opacity={0.8}
          sizeAttenuation
        />
      </points>

      {waterOilContactGeometry && (
        <points geometry={waterOilContactGeometry}>
          <pointsMaterial
            size={10}
            color="#00ffff"
            transparent
            opacity={0.9}
            sizeAttenuation
          />
        </points>
      )}
    </group>
  );
}

interface WaterOilContactSurfaceProps {
  contactPoints: { x: number; y: number; z: number }[];
  grid: Grid3D;
}

export function WaterOilContactSurface({ contactPoints, grid }: WaterOilContactSurfaceProps) {
  const { dimensions, origin, spacing } = grid;
  const { nx, ny } = dimensions;

  const surfaceGeometry = useMemo(() => {
    if (contactPoints.length < 4) return null;

    const contactMap = new Map<string, number>();
    contactPoints.forEach(p => {
      const key = `${Math.round(p.x / spacing.x)}_${Math.round(p.y / spacing.y)}`;
      contactMap.set(key, p.z);
    });

    const positions: number[] = [];
    const indices: number[] = [];
    const step = 2;

    const vertexIndexMap = new Map<string, number>();
    let vertexCount = 0;

    for (let ix = 0; ix < nx; ix += step) {
      for (let iy = 0; iy < ny; iy += step) {
        const key = `${ix}_${iy}`;
        const z = contactMap.get(key);
        
        if (z !== undefined) {
          vertexIndexMap.set(key, vertexCount);
          positions.push(
            origin.x + ix * spacing.x,
            origin.y + iy * spacing.y,
            z
          );
          vertexCount++;
        }
      }
    }

    for (let ix = 0; ix < nx - step; ix += step) {
      for (let iy = 0; iy < ny - step; iy += step) {
        const key00 = `${ix}_${iy}`;
        const key10 = `${ix + step}_${iy}`;
        const key01 = `${ix}_${iy + step}`;
        const key11 = `${ix + step}_${iy + step}`;

        const idx00 = vertexIndexMap.get(key00);
        const idx10 = vertexIndexMap.get(key10);
        const idx01 = vertexIndexMap.get(key01);
        const idx11 = vertexIndexMap.get(key11);

        if (idx00 !== undefined && idx10 !== undefined && idx11 !== undefined) {
          indices.push(idx00, idx10, idx11);
        }
        if (idx00 !== undefined && idx11 !== undefined && idx01 !== undefined) {
          indices.push(idx00, idx11, idx01);
        }
      }
    }

    if (positions.length === 0 || indices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }, [contactPoints, grid]);

  if (!surfaceGeometry) return null;

  return (
    <mesh geometry={surfaceGeometry}>
      <meshStandardMaterial
        color="#00bfff"
        transparent
        opacity={0.6}
        side={THREE.DoubleSide}
        metalness={0.1}
        roughness={0.8}
      />
    </mesh>
  );
}

interface ProductionChartProps {
  simulationResult: SimulationResult;
}

export function ProductionChart({ simulationResult }: ProductionChartProps) {
  const productionData = simulationResult.productionData;
  
  if (productionData.length === 0) return null;

  const maxOil = Math.max(...productionData.map(d => d.oilRate));
  const maxWater = Math.max(...productionData.map(d => d.waterRate));
  const maxRate = Math.max(maxOil, maxWater) || 1;
  const maxTime = productionData[productionData.length - 1].time || 1;

  const pointsToDisplay = 100;
  const step = Math.max(1, Math.floor(productionData.length / pointsToDisplay));

  const oilPoints: number[] = [];
  const waterPoints: number[] = [];

  for (let i = 0; i < productionData.length; i += step) {
    const data = productionData[i];
    const x = (data.time / maxTime) * 200 - 100;
    
    oilPoints.push(x, (data.oilRate / maxRate) * 50 - 25, 0);
    waterPoints.push(x, (data.waterRate / maxRate) * 50 - 25, 0);
  }

  const oilGeometry = new THREE.BufferGeometry();
  oilGeometry.setAttribute('position', new THREE.Float32BufferAttribute(oilPoints, 3));

  const waterGeometry = new THREE.BufferGeometry();
  waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(waterPoints, 3));

  return (
    <group position={[0, -150, 200]}>
      <mesh>
        <planeGeometry args={[220, 70]} />
        <meshBasicMaterial color="#1a1a2e" transparent opacity={0.8} />
      </mesh>
      
      <lineSegments geometry={oilGeometry}>
        <lineBasicMaterial color="#ff6b6b" linewidth={2} />
      </lineSegments>
      
      <lineSegments geometry={waterGeometry}>
        <lineBasicMaterial color="#4ecdc4" linewidth={2} />
      </lineSegments>
    </group>
  );
}
