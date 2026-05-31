import { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import type { ControversialPoint } from '@/services/collaboration';

interface ControversialPointsOverlayProps {
  scene: THREE.Scene | null;
  positions: Float32Array | null;
  controversialPoints: ControversialPoint[];
  visible: boolean;
}

export default function ControversialPointsOverlay({
  scene,
  positions,
  controversialPoints,
  visible,
}: ControversialPointsOverlayProps) {
  const pointsRef = useRef<THREE.Points | null>(null);
  const animationRef = useRef<number | null>(null);

  const controversialPositions = useMemo(() => {
    if (!positions || controversialPoints.length === 0) return null;

    const pos = new Float32Array(controversialPoints.length * 3);
    const colors = new Float32Array(controversialPoints.length * 3);

    controversialPoints.forEach((cp, i) => {
      const idx = cp.pointIndex * 3;
      pos[i * 3] = positions[idx];
      pos[i * 3 + 1] = positions[idx + 1];
      pos[i * 3 + 2] = positions[idx + 2];

      colors[i * 3] = 0.75;
      colors[i * 3 + 1] = 0.25;
      colors[i * 3 + 2] = 1.0;
    });

    return { positions: pos, colors };
  }, [positions, controversialPoints]);

  useEffect(() => {
    if (!scene || !controversialPositions || !visible) {
      if (pointsRef.current) {
        scene.remove(pointsRef.current);
        pointsRef.current.geometry.dispose();
        (pointsRef.current.material as THREE.Material).dispose();
        pointsRef.current = null;
      }
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(controversialPositions.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(controversialPositions.colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.name = 'controversial-points';

    scene.add(points);
    pointsRef.current = points;

    const startTime = Date.now();
    const animate = () => {
      if (!pointsRef.current || !material) return;

      const elapsed = (Date.now() - startTime) / 1000;
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 4);
      material.opacity = 0.4 + pulse * 0.6;
      material.size = 0.12 + pulse * 0.1;

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (pointsRef.current && scene) {
        scene.remove(pointsRef.current);
        pointsRef.current.geometry.dispose();
        (pointsRef.current.material as THREE.Material).dispose();
        pointsRef.current = null;
      }
    };
  }, [scene, controversialPositions, visible]);

  return null;
}
