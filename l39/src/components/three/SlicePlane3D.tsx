import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SliceParams, Grid3D, Formation } from '../../../shared/types';
import { normalize, cross, dot, subtract, add, multiplyScalar, hexToRgb } from '../../utils/geometry';
import { sliceAPI } from '../../utils/api';

interface SlicePlane3DProps {
  gridId: string;
  params: SliceParams;
  grid: Grid3D;
  formations: Formation[];
}

export function SlicePlane3D({ gridId, params, grid, formations }: SlicePlane3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [meshData, setMeshData] = useState<{ vertices: number[]; colors: number[]; indices: number[] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    
    const loadSliceMesh = async () => {
      setIsLoading(true);
      try {
        const result = await sliceAPI.generateMesh(gridId, params);
        if (!cancelled && result.vertices.length > 0) {
          setMeshData(result);
        }
      } catch (error) {
        console.error('Failed to load slice mesh:', error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadSliceMesh();
    
    return () => {
      cancelled = true;
    };
  }, [gridId, params]);

  const geometry = useMemo(() => {
    if (!meshData || meshData.vertices.length === 0) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(meshData.vertices, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(meshData.colors, 3));
    geom.setIndex(meshData.indices);
    geom.computeVertexNormals();
    
    return geom;
  }, [meshData]);

  const planeHelperGeometry = useMemo(() => {
    const { dimensions, origin, spacing } = grid;
    const { nx, ny, nz } = dimensions;
    
    const center = {
      x: origin.x + (nx - 1) * spacing.x / 2,
      y: origin.y + (ny - 1) * spacing.y / 2,
      z: origin.z + (nz - 1) * spacing.z / 2
    };

    const size = Math.max(
      (nx - 1) * spacing.x,
      (ny - 1) * spacing.y,
      (nz - 1) * spacing.z
    ) * 0.6;

    const n = normalize(params.normal);
    const up = { x: 0, y: 0, z: 1 };
    let right = cross(n, up);
    
    if (Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z) < 0.01) {
      right = cross(n, { x: 1, y: 0, z: 0 });
    }
    
    right = normalize(right);
    const trueUp = normalize(cross(right, n));

    const originPoint = params.origin || center;
    
    const corners = [
      add(originPoint, subtract(multiplyScalar(right, size), multiplyScalar(trueUp, size))),
      add(originPoint, add(multiplyScalar(right, size), multiplyScalar(trueUp, size))),
      add(originPoint, add(multiplyScalar(right, -size), multiplyScalar(trueUp, size))),
      add(originPoint, subtract(multiplyScalar(right, -size), multiplyScalar(trueUp, size)))
    ];

    const geom = new THREE.BufferGeometry();
    const vertices = new Float32Array(12);
    const indices = [0, 1, 2, 0, 2, 3];
    
    corners.forEach((c, i) => {
      vertices[i * 3] = c.x;
      vertices[i * 3 + 1] = c.y;
      vertices[i * 3 + 2] = c.z;
    });
    
    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geom.setIndex(indices);
    
    return geom;
  }, [params, grid]);

  useFrame((state, delta) => {
  });

  if (!geometry) {
    return (
      <mesh ref={meshRef} geometry={planeHelperGeometry}>
        <meshBasicMaterial
          color="#ff6b35"
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          wireframe
        />
      </mesh>
    );
  }

  return (
    <group>
      <mesh ref={meshRef} geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          side={THREE.DoubleSide}
          transparent
          opacity={0.9}
          roughness={0.5}
          metalness={0.1}
        />
      </mesh>
      
      <mesh geometry={planeHelperGeometry}>
        <meshBasicMaterial
          color="#ff6b35"
          transparent
          opacity={0.1}
          side={THREE.DoubleSide}
          wireframe
        />
      </mesh>

      <lineSegments geometry={new THREE.EdgesGeometry(planeHelperGeometry)}>
        <lineBasicMaterial color="#ff6b35" opacity={0.5} transparent />
      </lineSegments>
    </group>
  );
}
