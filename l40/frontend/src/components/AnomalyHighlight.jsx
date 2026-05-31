import React, { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import useAnomalyDetection from '../hooks/useAnomalyDetection';

const LEVEL_CONFIG = {
  normal: {
    color: new THREE.Color('#52c41a'),
    emissiveIntensity: 0,
    opacity: 0,
    animationMode: 'none',
  },
  warning: {
    color: new THREE.Color('#faad14'),
    emissiveIntensity: 0.4,
    opacity: 0.35,
    animationMode: 'pulse',
  },
  critical: {
    color: new THREE.Color('#ff4d4f'),
    emissiveIntensity: 0.7,
    opacity: 0.5,
    animationMode: 'flash',
  },
};

function AnomalyGlow({ level, animationMode, children }) {
  const meshRef = useRef();
  const materialRef = useRef();
  const timeRef = useRef(0);

  const config = LEVEL_CONFIG[level] || LEVEL_CONFIG.normal;
  const targetIntensity = config.emissiveIntensity;
  const targetOpacity = config.opacity;
  const targetColor = config.color;

  const currentIntensity = useRef(0);
  const currentOpacity = useRef(0);

  useFrame((_, delta) => {
    if (!materialRef.current) return;

    timeRef.current += delta;
    const t = timeRef.current;

    currentIntensity.current += (targetIntensity - currentIntensity.current) * Math.min(1, delta * 3);
    currentOpacity.current += (targetOpacity - currentOpacity.current) * Math.min(1, delta * 3);

    let intensity = currentIntensity.current;
    let opacity = currentOpacity.current;

    if (animationMode === 'pulse') {
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      intensity = currentIntensity.current * (0.5 + 0.5 * pulse);
      opacity = currentOpacity.current * (0.7 + 0.3 * pulse);
    } else if (animationMode === 'flash') {
      const flash = Math.sin(t * 8);
      intensity = currentIntensity.current * (0.3 + 0.7 * Math.max(0, flash));
      opacity = currentOpacity.current * (0.4 + 0.6 * Math.max(0, flash));
    }

    materialRef.current.emissiveIntensity = intensity;
    materialRef.current.opacity = opacity;
    materialRef.current.emissive.lerp(targetColor, delta * 5);
  });

  if (level === 'normal') {
    return <group>{children}</group>;
  }

  return (
    <group>
      {children}
      <mesh ref={meshRef} scale={[1.15, 1.15, 1.15]}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial
          ref={materialRef}
          transparent
          opacity={0}
          emissive={config.color}
          emissiveIntensity={0}
          color="#000000"
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function WarningIcon({ level, score, animationMode }) {
  const timeRef = useRef(0);

  useFrame((_, delta) => {
    timeRef.current += delta;
  });

  if (level === 'normal') return null;

  const iconColor = level === 'critical' ? '#ff4d4f' : '#faad14';
  const iconText = level === 'critical' ? '⚠' : '⚡';

  return (
    <Html position={[0, 1.8, 0]} center distanceFactor={10} zIndexRange={[100, 0]}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          animation: animationMode === 'flash' ? 'pulse-dot 0.8s infinite' : 'pulse-dot 2s infinite',
          pointerEvents: 'none',
        }}
      >
        <span style={{ fontSize: 20, filter: `drop-shadow(0 0 6px ${iconColor})` }}>
          {iconText}
        </span>
        <div
          style={{
            background: `${iconColor}20`,
            border: `1px solid ${iconColor}`,
            borderRadius: 4,
            padding: '2px 6px',
            color: iconColor,
            fontSize: 10,
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'nowrap',
          }}
        >
          {(score * 100).toFixed(0)}%
        </div>
      </div>
    </Html>
  );
}

function AnomalyDetailsPanel({ anomalyState, onClose }) {
  if (!anomalyState || anomalyState.level === 'normal') return null;

  const { score, level, details } = anomalyState;
  const borderColor = level === 'critical' ? '#ff4d4f' : '#faad14';

  return (
    <Html position={[0, 2.8, 0]} center distanceFactor={8} zIndexRange={[200, 0]}>
      <div
        style={{
          background: 'rgba(10, 22, 40, 0.95)',
          border: `1px solid ${borderColor}`,
          borderRadius: 8,
          padding: '12px 16px',
          color: '#e0e8f0',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          minWidth: 200,
          maxWidth: 280,
          pointerEvents: 'auto',
          cursor: 'default',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: borderColor, fontWeight: 600 }}>Anomaly Details</span>
          <span
            onClick={onClose}
            style={{ cursor: 'pointer', color: '#5a7a9a', fontSize: 14, lineHeight: 1 }}
          >
            ✕
          </span>
        </div>

        <div style={{ marginBottom: 6 }}>
          <span style={{ color: '#8ba3c0' }}>Score: </span>
          <span style={{ color: borderColor }}>{(score * 100).toFixed(1)}%</span>
        </div>

        {details?.features && (
          <>
            <div style={{ borderTop: '1px solid rgba(54, 207, 201, 0.1)', paddingTop: 6, marginBottom: 4 }}>
              <span style={{ color: '#36cfc9', fontSize: 10 }}>Features</span>
            </div>
            {details.features.rms != null && (
              <div style={{ color: '#8ba3c0' }}>
                RMS: <span style={{ color: '#e0e8f0' }}>{details.features.rms}</span>
              </div>
            )}
            {details.features.crestFactor != null && (
              <div style={{ color: '#8ba3c0' }}>
                Crest: <span style={{ color: '#e0e8f0' }}>{details.features.crestFactor}</span>
              </div>
            )}
            {details.features.kurtosis != null && (
              <div style={{ color: '#8ba3c0' }}>
                Kurtosis: <span style={{ color: '#e0e8f0' }}>{details.features.kurtosis}</span>
              </div>
            )}
          </>
        )}

        {details?.signals?.length > 0 && (
          <>
            <div style={{ borderTop: '1px solid rgba(54, 207, 201, 0.1)', paddingTop: 6, marginTop: 4 }}>
              <span style={{ color: '#36cfc9', fontSize: 10 }}>Alerts</span>
            </div>
            {details.signals.map((s, i) => (
              <div key={i} style={{ color: s.severity === 'critical' ? '#ff4d4f' : '#faad14' }}>
                {s.metric}: {s.value?.toFixed(2)} &gt; {s.threshold}
              </div>
            ))}
          </>
        )}
      </div>
    </Html>
  );
}

function AnomalyHighlight({
  equipmentId,
  children,
  anomalyLevel: externalLevel,
  anomalyScore: externalScore,
  anomalyDetails: externalDetails,
  animationMode: externalAnimationMode,
  onClick,
}) {
  const [showDetails, setShowDetails] = useState(false);

  const hookResult = useAnomalyDetection(equipmentId);
  const level = externalLevel || hookResult.anomalyState.level;
  const score = externalScore ?? hookResult.anomalyState.score;
  const details = externalDetails || hookResult.anomalyState.details;
  const animationMode = externalAnimationMode ||
    (level === 'critical' ? 'flash' : level === 'warning' ? 'pulse' : 'none');

  const config = LEVEL_CONFIG[level] || LEVEL_CONFIG.normal;

  const handleClick = (e) => {
    e.stopPropagation();
    if (level !== 'normal') {
      setShowDetails((prev) => !prev);
    }
    if (onClick) {
      onClick(e);
    }
  };

  return (
    <group onClick={handleClick}>
      <AnomalyGlow level={level} animationMode={animationMode}>
        {children}
      </AnomalyGlow>
      <WarningIcon level={level} score={score} animationMode={animationMode} />
      {showDetails && (
        <AnomalyDetailsPanel
          anomalyState={{ score, level, details }}
          onClose={() => setShowDetails(false)}
        />
      )}
    </group>
  );
}

export default React.memo(AnomalyHighlight);
