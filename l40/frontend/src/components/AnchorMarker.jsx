import React, { useRef, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Billboard } from '@react-three/drei';
import * as THREE from 'three';

const statusConfig = {
  locating: { color: '#1890ff', icon: '🔍', text: 'Locating...' },
  located: { color: '#36cfc9', icon: '📍', text: 'Located' },
  failed: { color: '#ff4d4f', icon: '❌', text: 'Failed' },
  pending: { color: '#faad14', icon: '⏳', text: 'Pending' },
  synced: { color: '#52c41a', icon: '✓', text: 'Synced' },
};

export default function AnchorMarker({ anchor, onClick, cameraPosition }) {
  const groupRef = useRef();
  const [hovered, setHovered] = useState(false);
  const pulseRef = useRef(0);
  const { camera } = useThree();

  const status = statusConfig[anchor.status] || statusConfig.located;
  const isLocal = anchor.isLocal || anchor.shared === false;
  const markerColor = isLocal ? '#36cfc9' : '#faad14';

  useFrame((_, delta) => {
    pulseRef.current += delta * 2;
    if (groupRef.current) {
      const scale = 1 + Math.sin(pulseRef.current) * 0.15;
      groupRef.current.scale.setScalar(anchor.status === 'located' ? scale : 1);
    }
  });

  const distance = useMemo(() => {
    if (!cameraPosition || !anchor.position) return null;
    const dx = (anchor.position.x || 0) - cameraPosition.x;
    const dy = (anchor.position.y || 0) - cameraPosition.y;
    const dz = (anchor.position.z || 0) - cameraPosition.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }, [cameraPosition, anchor.position]);

  if (!anchor || !anchor.position) return null;

  const posX = anchor.position.x || 0;
  const posY = anchor.position.y || 0;
  const posZ = anchor.position.z || 0;

  return (
    <group
      ref={groupRef}
      position={[posX, posY, posZ]}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(anchor);
      }}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <mesh>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshStandardMaterial
          color={status.color}
          emissive={status.color}
          emissiveIntensity={anchor.status === 'located' ? 0.8 : 0.3}
          transparent
          opacity={0.9}
        />
      </mesh>

      <mesh>
        <ringGeometry args={[0.08, 0.1, 32]} />
        <meshBasicMaterial
          color={markerColor}
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.005, 0.005, 0.15, 8]} />
        <meshBasicMaterial color={markerColor} transparent opacity={0.5} />
      </mesh>

      <Billboard position={[0, 0.25, 0]}>
        <Html
          center
          style={{
            pointerEvents: hovered ? 'auto' : 'none',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              background: hovered ? 'rgba(10, 22, 40, 0.95)' : 'rgba(10, 22, 40, 0.8)',
              border: `1px solid ${status.color}`,
              borderRadius: 6,
              padding: '6px 10px',
              minWidth: '120px',
              backdropFilter: 'blur(8px)',
              transition: 'all 0.2s',
              transform: hovered ? 'scale(1.05)' : 'scale(1)',
              boxShadow: hovered ? `0 0 15px ${status.color}40` : 'none',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 14 }}>{status.icon}</span>
              <span
                style={{
                  color: status.color,
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {status.text}
              </span>
              {anchor.isDemo && (
                <span
                  style={{
                    fontSize: 9,
                    color: '#faad14',
                    background: 'rgba(250, 173, 20, 0.1)',
                    padding: '1px 4px',
                    borderRadius: 3,
                  }}
                >
                  DEMO
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: 10,
                color: '#8ba3c0',
                fontFamily: "'JetBrains Mono', monospace",
                marginBottom: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              ID: {anchor.id || anchor.anchor_id}
            </div>

            {anchor.creator && (
              <div
                style={{
                  fontSize: 10,
                  color: '#5a7a9a',
                  marginBottom: 2,
                }}
              >
                by {anchor.creator}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 4,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  color: isLocal ? '#36cfc9' : '#faad14',
                  background: isLocal ? 'rgba(54, 207, 201, 0.1)' : 'rgba(250, 173, 20, 0.1)',
                  padding: '1px 6px',
                  borderRadius: 3,
                }}
              >
                {isLocal ? 'Local' : 'Shared'}
              </span>
              {distance !== null && (
                <span
                  style={{
                    fontSize: 9,
                    color: '#8ba3c0',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {distance.toFixed(2)}m
                </span>
              )}
            </div>

            {anchor.distance !== undefined && distance === null && (
              <div
                style={{
                  fontSize: 9,
                  color: '#8ba3c0',
                  fontFamily: "'JetBrains Mono', monospace",
                  marginTop: 2,
                }}
              >
                {anchor.distance.toFixed(2)}m
              </div>
            )}
          </div>
        </Html>
      </Billboard>

      {anchor.status === 'locating' && (
        <group>
          {[0, 1, 2].map((i) => (
            <mesh key={i} rotation={[Math.PI / 2, 0, (i * Math.PI * 2) / 3]}>
              <torusGeometry args={[0.12, 0.005, 8, 32]} />
              <meshBasicMaterial
                color="#1890ff"
                transparent
                opacity={0.6}
              />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}
