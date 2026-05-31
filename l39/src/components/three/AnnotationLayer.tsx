import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Annotation, Point3D } from '../../../shared/types';
import { useStore } from '../../store/useStore';

interface AnnotationLayerProps {
  annotations: Annotation[];
}

export function AnnotationLayer({ annotations }: AnnotationLayerProps) {
  const { camera } = useThree();

  const renderAnnotation = (annotation: Annotation) => {
    if (annotation.points.length === 0) return null;

    const color = new THREE.Color(annotation.color);

    switch (annotation.type) {
      case 'line':
      case 'fault':
        return renderLine(annotation, color);
      case 'well':
        return renderPoint(annotation, color);
      case 'polygon':
        return renderPolygon(annotation, color);
      case 'comment':
        return renderComment(annotation, color);
      default:
        return renderLine(annotation, color);
    }
  };

  const renderLine = (annotation: Annotation, color: THREE.Color) => {
    const points = annotation.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    return (
      <group key={annotation.id}>
        <lineSegments geometry={geometry}>
          <lineBasicMaterial color={color} linewidth={3} />
        </lineSegments>
        {points.map((point, idx) => (
          <mesh key={idx} position={point}>
            <sphereGeometry args={[3, 8, 8]} />
            <meshBasicMaterial color={color} />
          </mesh>
        ))}
      </group>
    );
  };

  const renderPoint = (annotation: Annotation, color: THREE.Color) => {
    if (annotation.points.length === 0) return null;
    const point = annotation.points[0];

    return (
      <group key={annotation.id}>
        <mesh position={[point.x, point.y, point.z]}>
          <coneGeometry args={[8, 20, 6]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <mesh position={[point.x, point.y, point.z - 10]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[8, 20, 6]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    );
  };

  const renderPolygon = (annotation: Annotation, color: THREE.Color) => {
    if (annotation.points.length < 3) return renderLine(annotation, color);

    const points = annotation.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
    points.push(points[0]);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    
    const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, p.y)));
    const geometry = new THREE.ShapeGeometry(shape);

    return (
      <group key={annotation.id}>
        <mesh geometry={geometry} position={[0, 0, points[0].z]}>
          <meshBasicMaterial color={color} transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
        <lineSegments geometry={lineGeometry}>
          <lineBasicMaterial color={color} linewidth={2} />
        </lineSegments>
      </group>
    );
  };

  const renderComment = (annotation: Annotation, color: THREE.Color) => {
    if (annotation.points.length === 0) return null;
    const point = annotation.points[0];

    return (
      <group key={annotation.id}>
        <mesh position={[point.x, point.y, point.z]}>
          <sphereGeometry args={[5, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.6} />
        </mesh>
        <mesh position={[point.x, point.y, point.z]}>
          <ringGeometry args={[5, 7, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  };

  if (annotations.length === 0) return null;

  return (
    <group name="annotations">
      {annotations.map(annotation => renderAnnotation(annotation))}
    </group>
  );
}

interface RemoteCursorsProps {
  cursors: Map<string, { x: number; y: number; point?: Point3D; userName: string; userColor: string }>;
}

export function RemoteCursors({ cursors }: RemoteCursorsProps) {
  const { viewport, size } = useThree();

  const cursorArray = useMemo(() => {
    return Array.from(cursors.entries());
  }, [cursors]);

  return (
    <group name="remote-cursors">
      {cursorArray.map(([userId, cursor]) => {
        if (!cursor.point) return null;
        
        return (
          <group key={userId} position={[cursor.point.x, cursor.point.y, cursor.point.z]}>
            <mesh>
              <sphereGeometry args={[4, 16, 16]} />
              <meshBasicMaterial color={cursor.userColor} transparent opacity={0.8} />
            </mesh>
            <mesh>
              <ringGeometry args={[4, 6, 32]} />
              <meshBasicMaterial color={cursor.userColor} transparent opacity={0.6} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
