import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

function ArrowMesh({ scale, opacity }) {
  const shaftLength = 0.4;
  const shaftWidth = 0.06;
  const headLength = 0.2;
  const headWidth = 0.18;

  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-shaftWidth / 2, 0);
    s.lineTo(-shaftWidth / 2, shaftLength);
    s.lineTo(-headWidth / 2, shaftLength);
    s.lineTo(0, shaftLength + headLength);
    s.lineTo(headWidth / 2, shaftLength);
    s.lineTo(shaftWidth / 2, shaftLength);
    s.lineTo(shaftWidth / 2, 0);
    s.lineTo(-shaftWidth / 2, 0);
    return s;
  }, []);

  return (
    <mesh scale={[scale, scale, scale]}>
      <extrudeGeometry args={[shape, { depth: 0.02, bevelEnabled: false }]} />
      <meshStandardMaterial
        color="#36cfc9"
        emissive="#36cfc9"
        emissiveIntensity={0.8 * opacity}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function SingleArrow({ targetPosition, userPosition, label, scale, opacity, onReached }) {
  const groupRef = useRef();
  const timeRef = useRef(0);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    timeRef.current += delta;

    const dx = targetPosition.x - userPosition.x;
    const dz = targetPosition.z - userPosition.z;
    const angle = Math.atan2(dx, dz);

    groupRef.current.rotation.x = -Math.PI / 2;
    groupRef.current.rotation.z = -angle;
    groupRef.current.rotation.y = 0;

    groupRef.current.position.set(
      userPosition.x,
      0.05 + Math.sin(timeRef.current * Math.PI * 2) * 0.05,
      userPosition.z
    );

    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 1.5 && onReached) {
      onReached();
    }
  });

  return (
    <group ref={groupRef}>
      <ArrowMesh scale={scale} opacity={opacity} />
      {label && (
        <Html
          position={[0, 0.5, 0]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              background: 'rgba(10,22,40,0.9)',
              border: '1px solid rgba(54,207,201,0.6)',
              borderRadius: 4,
              padding: '2px 8px',
              color: '#36cfc9',
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              whiteSpace: 'nowrap',
              opacity,
            }}
          >
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}

export default function NavigationArrow({
  waypoints = [],
  currentWaypointIndex = 0,
  userPosition = { x: 0, y: 0, z: 0 },
  onWaypointReached,
}) {
  const visibleCount = 3;
  const arrows = [];

  for (let i = 0; i < visibleCount; i++) {
    const wpIdx = currentWaypointIndex + i;
    if (wpIdx >= waypoints.length) break;

    const wp = waypoints[wpIdx];
    const opacity = 1 - i * 0.3;
    const scale = 1 - i * 0.15;
    const pos = i === 0 ? userPosition : waypoints[wpIdx - 1].position;
    const dist = Math.sqrt(
      (wp.position.x - pos.x) ** 2 +
      (wp.position.z - pos.z) ** 2
    );
    const label = i === 0 ? `${dist.toFixed(1)}m → ${wp.name}` : wp.name;

    arrows.push(
      <SingleArrow
        key={`arrow_${wpIdx}`}
        targetPosition={wp.position}
        userPosition={pos}
        label={label}
        scale={Math.max(scale, 0.4)}
        opacity={Math.max(opacity, 0.2)}
        onReached={i === 0 ? onWaypointReached : undefined}
      />
    );
  }

  return <group>{arrows}</group>;
}
