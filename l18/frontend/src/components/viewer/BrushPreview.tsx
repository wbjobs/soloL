import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { cn } from '@/lib/utils';
import { useAnnotationStore } from '@/store/useAnnotationStore';
import type { Point3D } from '@/types';
import { hexToRgbNormalized } from '@/utils/colorMap';

interface BrushPreviewProps {
  scene: THREE.Scene | null;
  visible: boolean;
  position: Point3D | null;
  className?: string;
}

export default function BrushPreview({ scene, visible, position, className }: BrushPreviewProps) {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const { brushSettings, labels, currentLabelId } = useAnnotationStore();

  useEffect(() => {
    if (!scene) return;

    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    scene.add(mesh);
    meshRef.current = mesh;

    return () => {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    };
  }, [scene]);

  useEffect(() => {
    if (!meshRef.current) return;

    const { shape, size } = brushSettings;

    meshRef.current.geometry.dispose();

    if (shape === 'sphere') {
      meshRef.current.geometry = new THREE.SphereGeometry(size, 32, 32);
    } else {
      meshRef.current.geometry = new THREE.BoxGeometry(size * 2, size * 2, size * 2);
    }
  }, [brushSettings.shape, brushSettings.size]);

  useEffect(() => {
    if (!meshRef.current) return;

    const label = labels.find((l) => l.id === currentLabelId);
    if (label) {
      const [r, g, b] = hexToRgbNormalized(label.color);
      const material = meshRef.current.material as THREE.MeshBasicMaterial;
      material.color.setRGB(r, g, b);
    }
  }, [currentLabelId, labels]);

  useEffect(() => {
    if (!meshRef.current) return;

    meshRef.current.visible = visible && position !== null;

    if (visible && position) {
      meshRef.current.position.set(position.x, position.y, position.z);
    }
  }, [visible, position]);

  return <div className={cn('pointer-events-none', className)} />;
}
