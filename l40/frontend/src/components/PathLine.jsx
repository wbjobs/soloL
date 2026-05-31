import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

function WaypointMarker({ position, name, priority, index }) {
  const color = priority >= 5 ? '#ff4d4f' : priority >= 4 ? '#faad14' : priority >= 3 ? '#36cfc9' : '#5a7a9a';
  const stars = '★'.repeat(priority) + '☆'.repeat(5 - priority);

  return (
    <group position={[position.x, 0.02, position.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.12, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.6}
          transparent
          opacity={0.8}
        />
      </mesh>
      <Html
        position={[0, 0.3, 0]}
        center
        style={{ pointerEvents: 'none' }}
      >
        <div
          style={{
            background: 'rgba(10,22,40,0.9)',
            border: `1px solid ${color}`,
            borderRadius: 4,
            padding: '2px 6px',
            color: '#e0e8f0',
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
        >
          <div style={{ color, fontSize: 9 }}>#{index + 1}</div>
          <div>{name}</div>
          <div style={{ color, fontSize: 9 }}>{stars}</div>
        </div>
      </Html>
    </group>
  );
}

export default function PathLine({ path = [], waypointLabels = [] }) {
  const lineRef = useRef();
  const dashOffsetRef = useRef(0);

  const geometry = useMemo(() => {
    if (path.length < 2) return null;

    const points = path.map(
      (p) => new THREE.Vector3(p.position.x, 0.03, p.position.z)
    );
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    lineGeo.computeLineDistances?.();
    return lineGeo;
  }, [path]);

  const material = useMemo(() => {
    return new THREE.LineDashedMaterial({
      color: 0x36cfc9,
      transparent: true,
      opacity: 0.6,
      dashSize: 0.3,
      gapSize: 0.15,
    });
  }, []);

  useEffect(() => {
    if (lineRef.current) {
      lineRef.current.computeLineDistances();
    }
  }, [geometry]);

  useFrame((_, delta) => {
    if (!lineRef.current) return;
    dashOffsetRef.current -= delta * 0.5;
    lineRef.current.material.dashOffset = dashOffsetRef.current;
  });

  if (path.length < 2) return null;

  return (
    <group>
      <line ref={lineRef} geometry={geometry} material={material} />
      {path.map((wp, idx) => (
        <WaypointMarker
          key={wp.nodeId || idx}
          position={wp.position}
          name={waypointLabels[idx]?.name || wp.name || `WP ${idx + 1}`}
          priority={waypointLabels[idx]?.priority || wp.priority || 3}
          index={idx}
        />
      ))}
    </group>
  );
}
