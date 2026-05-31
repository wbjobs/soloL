import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { onAnnotation } from '../services/webrtc';

const DEFAULT_EXPIRY_MS = 30000;

function ArrowAnnotation({ data, color, opacity }) {
  const { pointA, pointB } = data;
  const groupRef = useRef();

  const direction = useMemo(() => {
    const a = new THREE.Vector3(pointA.x, pointA.y, pointA.z);
    const b = new THREE.Vector3(pointB.x, pointB.y, pointB.z);
    return new THREE.Vector3().subVectors(b, a);
  }, [pointA, pointB]);

  const length = useMemo(() => direction.length(), [direction]);
  const origin = useMemo(() => new THREE.Vector3(pointA.x, pointA.y, pointA.z), [pointA]);

  const shaftGeo = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.02, 0.02, Math.max(0.01, length - 0.08), 8);
    geo.translate(0, (length - 0.08) / 2, 0);
    return geo;
  }, [length]);

  const headGeo = useMemo(() => {
    const geo = new THREE.ConeGeometry(0.05, 0.08, 8);
    geo.translate(0, length - 0.04, 0);
    return geo;
  }, [length]);

  const quaternion = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
    return q;
  }, [direction]);

  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false }),
    [color, opacity]
  );

  return (
    <group ref={groupRef} position={origin} quaternion={quaternion}>
      <mesh geometry={shaftGeo} material={mat} renderOrder={999} />
      <mesh geometry={headGeo} material={mat} renderOrder={999} />
    </group>
  );
}

function CircleAnnotation({ data, color, opacity }) {
  const { position, normal, radius = 0.15 } = data;

  const points = useMemo(() => {
    const pts = [];
    const segments = 48;
    const center = new THREE.Vector3(position.x, position.y, position.z);
    const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    const arbitrary = Math.abs(n.y) < 0.99
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(n, arbitrary).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const pt = center.clone()
        .addScaledVector(u, Math.cos(angle) * radius)
        .addScaledVector(v, Math.sin(angle) * radius);
      pts.push(pt);
    }
    return pts;
  }, [position, normal, radius]);

  const lineGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    return geo;
  }, [points]);

  const mat = useMemo(
    () => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }),
    [color, opacity]
  );

  return <line geometry={lineGeo} material={mat} renderOrder={999} />;
}

function FreehandAnnotation({ data, color, opacity }) {
  const { points: rawPoints } = data;

  const tubeGeo = useMemo(() => {
    if (!rawPoints || rawPoints.length < 2) return null;
    const pts = rawPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(pts);
    return new THREE.TubeGeometry(curve, Math.max(2, pts.length * 4), 0.015, 6, false);
  }, [rawPoints]);

  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false }),
    [color, opacity]
  );

  if (!tubeGeo) return null;
  return <mesh geometry={tubeGeo} material={mat} renderOrder={999} />;
}

function CursorAnnotation({ data }) {
  const { position } = data;
  if (!position) return null;

  return (
    <mesh position={[position.x, position.y, position.z]} renderOrder={1000}>
      <sphereGeometry args={[0.03, 12, 12]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.8} depthTest={false} />
    </mesh>
  );
}

function AnnotationItem({ annotation, expiryMs }) {
  const [opacity, setOpacity] = useState(0);
  const [expired, setExpired] = useState(false);
  const startTimeRef = useRef(Date.now());

  useFrame(() => {
    const elapsed = Date.now() - startTimeRef.current;
    const fadeTime = 500;

    if (elapsed < fadeTime) {
      setOpacity(elapsed / fadeTime);
    } else {
      setOpacity(1);
    }

    if (expiryMs > 0 && elapsed > expiryMs) {
      setExpired(true);
    }
  });

  if (expired) return null;

  const color = annotation.color || '#ff4444';

  switch (annotation.type) {
    case 'arrow':
      return <ArrowAnnotation data={annotation.data} color={color} opacity={opacity} />;
    case 'circle':
      return <CircleAnnotation data={annotation.data} color={color} opacity={opacity} />;
    case 'freehand':
      return <FreehandAnnotation data={annotation.data} color={color} opacity={opacity} />;
    case 'cursor':
      return <CursorAnnotation data={annotation.data} />;
    default:
      return null;
  }
}

export default function RemoteAnnotation({ expiryMs = DEFAULT_EXPIRY_MS }) {
  const [annotations, setAnnotations] = useState([]);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  useEffect(() => {
    const unsub = onAnnotation((msg) => {
      switch (msg.type) {
        case 'annotation': {
          const ann = msg.data;
          if (!ann.id) ann.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setAnnotations((prev) => [...prev, ann]);
          break;
        }
        case 'clear':
          setAnnotations([]);
          break;
        case 'undo': {
          const { author } = msg.data;
          if (author) {
            setAnnotations((prev) => {
              for (let i = prev.length - 1; i >= 0; i--) {
                if (prev[i].author === author) {
                  return [...prev.slice(0, i), ...prev.slice(i + 1)];
                }
              }
              return prev;
            });
          } else {
            setAnnotations((prev) => prev.slice(0, -1));
          }
          break;
        }
        case 'cursor': {
          setAnnotations((prev) => {
            const filtered = prev.filter((a) => a.type !== 'cursor' || a.author !== msg.data.author);
            return [
              ...filtered,
              { id: `cursor-${msg.data.author || 'remote'}`, type: 'cursor', data: msg.data, author: msg.data.author, timestamp: Date.now() },
            ];
          });
          break;
        }
      }
    });
    return unsub;
  }, []);

  return (
    <group>
      {annotations.map((ann) => (
        <AnnotationItem
          key={ann.id}
          annotation={ann}
          expiryMs={ann.type === 'cursor' ? 5000 : expiryMs}
        />
      ))}
    </group>
  );
}
