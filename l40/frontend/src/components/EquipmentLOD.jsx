import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
import Billboard from './Billboard';

const LOD_LEVELS = {
  HIGH: 'high',
  LOW: 'low',
  BILLBOARD: 'billboard',
};

const DEFAULT_THRESHOLDS = {
  high: 10,
  low: 20,
};

function disposeObject(object) {
  if (!object) return;

  object.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => {
            if (mat.map) mat.map.dispose();
            if (mat.normalMap) mat.normalMap.dispose();
            if (mat.roughnessMap) mat.roughnessMap.dispose();
            if (mat.metalnessMap) mat.metalnessMap.dispose();
            if (mat.emissiveMap) mat.emissiveMap.dispose();
            if (mat.aoMap) mat.aoMap.dispose();
            if (mat.displacementMap) mat.displacementMap.dispose();
            mat.dispose();
          });
        } else {
          if (child.material.map) child.material.map.dispose();
          if (child.material.normalMap) child.material.normalMap.dispose();
          if (child.material.roughnessMap) child.material.roughnessMap.dispose();
          if (child.material.metalnessMap) child.material.metalnessMap.dispose();
          if (child.material.emissiveMap) child.material.emissiveMap.dispose();
          if (child.material.aoMap) child.material.aoMap.dispose();
          if (child.material.displacementMap) child.material.displacementMap.dispose();
          child.material.dispose();
        }
      }
    }
  });
}

function DefectMarker({ defect, scale = 1 }) {
  const colorMap = {
    low: '#52c41a',
    medium: '#faad14',
    high: '#fa8c16',
    critical: '#ff4d4f',
  };
  const color = colorMap[defect.severity] || '#ff4d4f';
  const markerSize = 0.04 * scale;

  return (
    <mesh position={[defect.position.x, defect.position.y, defect.position.z]}>
      <sphereGeometry args={[markerSize, 16, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.6}
        transparent
        opacity={0.85}
      />
    </mesh>
  );
}

function EquipmentModel({ url, onLoad, isShadowOptimized = false }) {
  const { scene } = useGLTF(url);
  const groupRef = useRef();

  useEffect(() => {
    if (scene) {
      scene.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = !isShadowOptimized;
          child.receiveShadow = !isShadowOptimized;
        }
      });
      if (onLoad) {
        onLoad(scene);
      }
    }
  }, [scene, onLoad, isShadowOptimized]);

  return <primitive ref={groupRef} object={scene} />;
}

function LoadingPlaceholder() {
  return (
    <Html center distanceFactor={10}>
      <div
        style={{
          background: 'rgba(10, 22, 40, 0.9)',
          border: '1px solid rgba(54, 207, 201, 0.3)',
          borderRadius: 6,
          padding: '12px 20px',
          color: '#36cfc9',
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          textAlign: 'center',
        }}
      >
        <div style={{ marginBottom: 6 }}>Loading model...</div>
        <div style={{ width: 100, height: 3, background: '#1e3a5f', borderRadius: 2, overflow: 'hidden' }}>
          <div
            style={{
              width: '60%',
              height: '100%',
              background: '#36cfc9',
              animation: 'pulse-dot 1.5s infinite',
            }}
          />
        </div>
      </div>
    </Html>
  );
}

function EquipmentLOD({
  equipment,
  highModelUrl,
  lowModelUrl,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  thresholds = DEFAULT_THRESHOLDS,
  onLodChange,
  onClick,
  defects = [],
  isShadowOptimized = false,
  lodBias = 1,
}) {
  const { camera } = useThree();
  const groupRef = useRef();
  const [currentLevel, setCurrentLevel] = useState(LOD_LEVELS.BILLBOARD);
  const [targetLevel, setTargetLevel] = useState(LOD_LEVELS.BILLBOARD);
  const [opacity, setOpacity] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedModels, setLoadedModels] = useState({ high: false, low: false });
  const lastLevelRef = useRef(null);
  const transitionRef = useRef(null);

  const effectiveThresholds = useMemo(() => ({
    high: thresholds.high * lodBias,
    low: thresholds.low * lodBias,
  }), [thresholds, lodBias]);

  const getDistance = useCallback(() => {
    if (!groupRef.current) return Infinity;
    const anchor = new THREE.Vector3(...position);
    return camera.position.distanceTo(anchor);
  }, [camera, position]);

  const determineLevel = useCallback((distance) => {
    if (distance < effectiveThresholds.high) return LOD_LEVELS.HIGH;
    if (distance < effectiveThresholds.low) return LOD_LEVELS.LOW;
    return LOD_LEVELS.BILLBOARD;
  }, [effectiveThresholds]);

  const switchLevel = useCallback((newLevel) => {
    if (newLevel === lastLevelRef.current) return;

    setIsLoading(true);
    setOpacity(prev => prev);

    const startFadeOut = () => {
      if (transitionRef.current) {
        clearInterval(transitionRef.current);
      }

      let currentOpacity = opacity;
      transitionRef.current = setInterval(() => {
        currentOpacity -= 0.1;
        if (currentOpacity <= 0) {
          clearInterval(transitionRef.current);
          setOpacity(0);

          if (lastLevelRef.current !== newLevel) {
            if (lastLevelRef.current === LOD_LEVELS.HIGH && newLevel !== LOD_LEVELS.HIGH) {
              disposeObject(groupRef.current?.getObjectByName('highModel'));
            }
            if (lastLevelRef.current === LOD_LEVELS.LOW && newLevel !== LOD_LEVELS.LOW) {
              disposeObject(groupRef.current?.getObjectByName('lowModel'));
            }
          }

          setCurrentLevel(newLevel);
          lastLevelRef.current = newLevel;

          setTimeout(() => {
            let fadeInOpacity = 0;
            const fadeInInterval = setInterval(() => {
              fadeInOpacity += 0.1;
              if (fadeInOpacity >= 1) {
                clearInterval(fadeInInterval);
                setOpacity(1);
                setIsLoading(false);
              } else {
                setOpacity(fadeInOpacity);
              }
            }, 30);
          }, 50);

          if (onLodChange) {
            onLodChange({ equipment, from: lastLevelRef.current, to: newLevel });
          }
        } else {
          setOpacity(currentOpacity);
        }
      }, 30);
    };

    startFadeOut();
  }, [onLodChange, equipment, opacity]);

  useFrame(() => {
    const distance = getDistance();
    const newTargetLevel = determineLevel(distance);

    if (newTargetLevel !== targetLevel) {
      setTargetLevel(newTargetLevel);
      if (!isLoading && newTargetLevel !== currentLevel) {
        switchLevel(newTargetLevel);
      }
    }
  });

  useEffect(() => {
    return () => {
      if (transitionRef.current) {
        clearInterval(transitionRef.current);
      }
      if (groupRef.current) {
        disposeObject(groupRef.current);
      }
    };
  }, []);

  const handleModelLoad = useCallback((level) => {
    setLoadedModels(prev => ({ ...prev, [level]: true }));
  }, []);

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    if (onClick) {
      onClick(equipment, e.point);
    }
  }, [onClick, equipment]);

  const billboardSize = useMemo(() => {
    const distance = getDistance();
    if (distance > 30) return 'small';
    return 'normal';
  }, [getDistance]);

  const renderContent = () => {
    if (isLoading && currentLevel === LOD_LEVELS.BILLBOARD) {
      return <LoadingPlaceholder />;
    }

    switch (currentLevel) {
      case LOD_LEVELS.HIGH:
        return (
          <group name="highModel" onClick={handleClick} opacity={opacity}>
            <EquipmentModel
              url={highModelUrl}
              onLoad={() => handleModelLoad('high')}
              isShadowOptimized={isShadowOptimized}
            />
            {defects.map((defect, i) => (
              <DefectMarker key={defect.id || i} defect={defect} scale={scale} />
            ))}
          </group>
        );

      case LOD_LEVELS.LOW:
        return (
          <group name="lowModel" onClick={handleClick} opacity={opacity}>
            <EquipmentModel
              url={lowModelUrl}
              onLoad={() => handleModelLoad('low')}
              isShadowOptimized={isShadowOptimized}
            />
            {defects.map((defect, i) => (
              <DefectMarker key={defect.id || i} defect={defect} scale={scale * 0.8} />
            ))}
          </group>
        );

      case LOD_LEVELS.BILLBOARD:
      default:
        return (
          <group opacity={opacity}>
            <Billboard
              equipment={equipment}
              size={billboardSize}
              onClick={() => onClick?.(equipment)}
              position={[0, 2 * scale, 0]}
              fadeNear={15}
              fadeFar={50}
            />
            {defects.map((defect, i) => (
              <DefectMarker key={defect.id || i} defect={defect} scale={scale * 0.6} />
            ))}
          </group>
        );
    }
  };

  const lodBadgeColor = {
    [LOD_LEVELS.HIGH]: '#52c41a',
    [LOD_LEVELS.LOW]: '#faad14',
    [LOD_LEVELS.BILLBOARD]: '#1890ff',
  };

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale}>
      {renderContent()}

      {isLoading && currentLevel !== LOD_LEVELS.BILLBOARD && (
        <Html center distanceFactor={10} position={[0, 2.5 * scale, 0]}>
          <div
            style={{
              background: 'rgba(10, 22, 40, 0.8)',
              border: '1px solid rgba(54, 207, 201, 0.2)',
              borderRadius: 4,
              padding: '4px 8px',
              color: '#36cfc9',
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            ⟳ Loading LOD...
          </div>
        </Html>
      )}

      <Html position={[0, -0.5 * scale, 0]} center distanceFactor={15}>
        <div
          className="lod-indicator"
          style={{
            background: `${lodBadgeColor[currentLevel]}20`,
            border: `1px solid ${lodBadgeColor[currentLevel]}`,
            color: lodBadgeColor[currentLevel],
            fontSize: 9,
            padding: '2px 6px',
            borderRadius: 3,
            fontFamily: "'JetBrains Mono', monospace",
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            whiteSpace: 'nowrap',
            opacity: 0.7,
            pointerEvents: 'none',
          }}
        >
          LOD: {currentLevel.toUpperCase()}
        </div>
      </Html>
    </group>
  );
}

export default React.memo(EquipmentLOD);
