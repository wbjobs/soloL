import { useRef, useMemo, useMemo as _useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Grid3D, Formation } from '../../../shared/types';
import { hexToRgb } from '../../utils/geometry';

interface GeologicalModelProps {
  grid: Grid3D;
  formations: Formation[];
  opacity: number;
  showWireframe: boolean;
}

export function GeologicalModel({ grid, formations, opacity, showWireframe }: GeologicalModelProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireframeRef = useRef<THREE.LineSegments>(null);

  const { geometry, colors } = useMemo(() => {
    const { dimensions, origin, spacing, formationIds } = grid;
    const { nx, ny, nz } = dimensions;
    const totalSize = nx * ny * nz;

    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const vertexColors: number[] = [];
    const indices: number[] = [];

    const formationColorMap = new Map<number, THREE.Color>();
    formations.forEach(f => {
      const rgb = hexToRgb(f.color);
      formationColorMap.set(f.id, new THREE.Color(rgb.r, rgb.g, rgb.b));
    });

    const step = Math.max(1, Math.floor(Math.min(nx, ny, nz) / 80));

    let vertexIndex = 0;
    for (let iz = 0; iz < nz - 1; iz += step) {
      for (let iy = 0; iy < ny - 1; iy += step) {
        for (let ix = 0; ix < nx - 1; ix += step) {
          const idx = iz * nx * ny + iy * nx + ix;
          const formationId = formationIds[idx];
          const color = formationColorMap.get(formationId) || new THREE.Color(0x888888);

          const x0 = origin.x + ix * spacing.x;
          const y0 = origin.y + iy * spacing.y;
          const z0 = origin.z + iz * spacing.z;
          const x1 = origin.x + (ix + step) * spacing.x;
          const y1 = origin.y + (iy + step) * spacing.y;
          const z1 = origin.z + (iz + step) * spacing.z;

          const corners = [
            [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
            [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
          ];

          const faces = [
            [0, 1, 2], [0, 2, 3],
            [4, 6, 5], [4, 7, 6],
            [0, 4, 5], [0, 5, 1],
            [2, 6, 7], [2, 7, 3],
            [0, 3, 7], [0, 7, 4],
            [1, 5, 6], [1, 6, 2]
          ];

          for (const [i1, i2, i3] of faces) {
            vertices.push(...corners[i1], ...corners[i2], ...corners[i3]);
            for (let c = 0; c < 3; c++) {
              vertexColors.push(color.r, color.g, color.b);
            }
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            vertexIndex += 3;
          }
        }
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return { geometry, colors: vertexColors };
  }, [grid, formations]);

  const wireframeGeometry = useMemo(() => {
    return new THREE.EdgesGeometry(geometry);
  }, [geometry]);

  useFrame((state, delta) => {
    if (meshRef.current) {
    }
  });

  return (
    <group>
      <mesh ref={meshRef} geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>
      {showWireframe && (
        <lineSegments ref={wireframeRef} geometry={wireframeGeometry}>
          <lineBasicMaterial color="#ffffff" opacity={0.3} transparent />
        </lineSegments>
      )}
    </group>
  );
}
