import React, { Suspense, useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, useGLTF, Html, ContactShadows, Stats } from '@react-three/drei';
import { Spin, Switch, Tag, Space } from 'antd';
import * as THREE from 'three';
import EquipmentLOD from './EquipmentLOD';
import AnchorMarker from './AnchorMarker';
import AnomalyHighlight from './AnomalyHighlight';
import NavigationArrow from './NavigationArrow';
import PathLine from './PathLine';
import RemoteAnnotation from './RemoteAnnotation';
import usePerformanceMonitor from '../hooks/usePerformanceMonitor';

const LOD_LEVELS = {
  HIGH: 'high',
  LOW: 'low',
  BILLBOARD: 'billboard',
};

function SensorHotspot({ position, label, value, unit }) {
  const statusColor = (val, type) => {
    if (val == null) return '#8ba3c0';
    if (type === 'temperature') {
      if (val > 95) return '#ff4d4f';
      if (val > 80) return '#faad14';
    } else if (type === 'vibration') {
      if (val > 8) return '#ff4d4f';
      if (val > 5) return '#faad14';
    }
    return '#36cfc9';
  };

  const typeMap = { 温度: 'temperature', 振动: 'vibration', 转速: 'rpm' };
  const sColor = statusColor(value, typeMap[label]);

  return (
    <group position={[position.x, position.y + 0.08, position.z]}>
      <mesh>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial color={sColor} emissive={sColor} emissiveIntensity={1} />
      </mesh>
      <Html
        position={[0, 0.06, 0]}
        center
        style={{ pointerEvents: 'none' }}
      >
        <div
          style={{
            background: 'rgba(10,22,40,0.9)',
            border: `1px solid ${sColor}`,
            borderRadius: 4,
            padding: '2px 6px',
            color: sColor,
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
        >
          {label}: {value != null ? `${value}${unit}` : '--'}
        </div>
      </Html>
    </group>
  );
}

function FrustumCulledEquipment({ equipment, defects, onEquipmentClick, onLodChange, arMode, lodBias, maxHighResModels }) {
  const { camera } = useThree();
  const groupRef = useRef();
  const frustumRef = useRef(new THREE.Frustum());
  const projScreenMatrixRef = useRef(new THREE.Matrix4());
  const [visibleEquipment, setVisibleEquipment] = useState([]);
  const highResCountRef = useRef(0);

  useFrame(() => {
    if (!groupRef.current) return;

    camera.updateMatrixWorld();
    projScreenMatrixRef.current.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustumRef.current.setFromProjectionMatrix(projScreenMatrixRef.current);

    const visible = [];
    let highResCount = 0;

    equipment.forEach((eq) => {
      const position = new THREE.Vector3(
        eq.position?.x || 0,
        eq.position?.y || 0,
        eq.position?.z || 0
      );
      const sphere = new THREE.Sphere(position, 5);

      if (frustumRef.current.intersectsSphere(sphere)) {
        const distance = camera.position.distanceTo(position);
        let lodLevel = LOD_LEVELS.BILLBOARD;

        if (distance < 10 * lodBias) {
          if (arMode && highResCount >= maxHighResModels) {
            lodLevel = LOD_LEVELS.LOW;
          } else {
            lodLevel = LOD_LEVELS.HIGH;
            highResCount++;
          }
        } else if (distance < 20 * lodBias) {
          lodLevel = LOD_LEVELS.LOW;
        }

        visible.push({ ...eq, distance, lodLevel });
      }
    });

    highResCountRef.current = highResCount;
    setVisibleEquipment(visible);
  });

  return (
    <group ref={groupRef}>
      {visibleEquipment.map((eq, index) => (
        <EquipmentLOD
          key={eq.id || index}
          equipment={eq}
          highModelUrl={eq.highModelUrl || eq.modelUrl}
          lowModelUrl={eq.lowModelUrl || eq.modelUrl}
          position={[eq.position?.x || 0, eq.position?.y || 0, eq.position?.z || 0]}
          rotation={eq.rotation || [0, 0, 0]}
          scale={eq.scale || 1}
          thresholds={arMode ? { high: 8, low: 15 } : { high: 10, low: 20 }}
          onLodChange={onLodChange}
          onClick={onEquipmentClick}
          defects={defects[eq.id] || []}
          isShadowOptimized={arMode}
          lodBias={lodBias}
        />
      ))}
    </group>
  );
}

function SceneStatsOverlay({ stats, arMode, onToggleAr, isLowPerformance }) {
  const { fps, memory, drawCalls, triangleCount, lodCounts } = stats;

  const formatBytes = (bytes) => {
    if (!bytes) return 'N/A';
    const mb = bytes / (1024 * 1024);
    if (mb > 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb.toFixed(1)} MB`;
  };

  const fpsColor = fps >= 50 ? '#52c41a' : fps >= 30 ? '#faad14' : '#ff4d4f';

  return (
    <Html position={[0, 0, 0]} style={{ position: 'absolute', top: 10, left: 10, right: 10, pointerEvents: 'none' }}>
      <div
        className="ar-performance-panel"
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            background: 'rgba(10, 22, 40, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(54, 207, 201, 0.2)',
            borderRadius: 6,
            padding: '10px 14px',
            minWidth: 200,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: '#5a7a9a',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: 8,
            }}
          >
            Scene Stats
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 12 }}>
            <div style={{ color: '#8ba3c0' }}>FPS:</div>
            <div style={{ color: fpsColor, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
              {fps}
            </div>
            <div style={{ color: '#8ba3c0' }}>Draw Calls:</div>
            <div style={{ color: '#e0e8f0', fontFamily: "'JetBrains Mono', monospace" }}>
              {drawCalls.toLocaleString()}
            </div>
            <div style={{ color: '#8ba3c0' }}>Triangles:</div>
            <div style={{ color: '#e0e8f0', fontFamily: "'JetBrains Mono', monospace" }}>
              {(triangleCount / 1000).toFixed(1)}K
            </div>
            <div style={{ color: '#8ba3c0' }}>Memory:</div>
            <div style={{ color: '#e0e8f0', fontFamily: "'JetBrains Mono', monospace" }}>
              {formatBytes(memory?.used)}
            </div>
          </div>

          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(54, 207, 201, 0.1)' }}>
            <div style={{ fontSize: 11, color: '#5a7a9a', marginBottom: 4 }}>Active LOD:</div>
            <Space size={4}>
              <Tag color="success" style={{ fontSize: 10, margin: 0, padding: '0 6px' }}>
                HI: {lodCounts?.high || 0}
              </Tag>
              <Tag color="warning" style={{ fontSize: 10, margin: 0, padding: '0 6px' }}>
                LO: {lodCounts?.low || 0}
              </Tag>
              <Tag color="blue" style={{ fontSize: 10, margin: 0, padding: '0 6px' }}>
                2D: {lodCounts?.billboard || 0}
              </Tag>
            </Space>
          </div>

          {isLowPerformance && (
            <div
              style={{
                marginTop: 8,
                padding: '6px 8px',
                background: 'rgba(255, 77, 79, 0.1)',
                border: '1px solid rgba(255, 77, 79, 0.3)',
                borderRadius: 4,
                fontSize: 10,
                color: '#ff4d4f',
              }}
            >
              ⚠ Low Performance - LOD bias active
            </div>
          )}
        </div>

        <div
          style={{
            background: 'rgba(10, 22, 40, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(54, 207, 201, 0.2)',
            borderRadius: 6,
            padding: '10px 14px',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: '#5a7a9a',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: 8,
            }}
          >
            Display Mode
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#8ba3c0' }}>AR Mode:</span>
            <Switch
              size="small"
              checked={arMode}
              onChange={onToggleAr}
              checkedChildren="ON"
              unCheckedChildren="OFF"
            />
          </div>
          {arMode && (
            <div style={{ marginTop: 6, fontSize: 10, color: '#36cfc9' }}>
              HoloLens optimizations active
            </div>
          )}
        </div>
      </div>
    </Html>
  );
}

function Scene({
  equipmentList,
  onEquipmentClick,
  onModelClick,
  defects,
  sensorData,
  arMode,
  onToggleAr,
  perfMonitor,
  onLodChange,
  lodCounts,
  anchors = [],
  cameraPositionRef,
  showPerformance = false,
  anomalyAlerts = {},
  navigationPath = null,
}) {
  const { gl, camera } = useThree();
  const sceneRef = useRef();
  const [camPos, setCamPos] = useState({ x: 0, y: 0, z: 0 });
  const [triangleCount, setTriangleCount] = useState(0);
  const [drawCalls, setDrawCalls] = useState(0);

  useFrame(() => {
    const pos = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    };
    setCamPos(pos);
    if (cameraPositionRef) {
      cameraPositionRef.current = pos;
    }

    if (gl.info) {
      setDrawCalls(gl.info.render.calls);
      setTriangleCount(gl.info.render.triangles);
      perfMonitor.updateStats({
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      });
    }
  });

  const defaultSensorPositions = useMemo(() => {
    if (!sensorData) return [];
    return [
      { position: { x: 0.3, y: 0.5, z: 0 }, label: '温度', value: sensorData.temperature, unit: '°C' },
      { position: { x: -0.3, y: 0.3, z: 0.2 }, label: '振动', value: sensorData.vibration, unit: 'mm/s' },
      { position: { x: 0, y: 0.6, z: -0.3 }, label: '转速', value: sensorData.rpm, unit: 'RPM' },
    ];
  }, [sensorData]);

  const shadowQuality = arMode ? 0 : 1;
  const maxHighResModels = arMode ? 5 : 999;

  return (
    <group ref={sceneRef}>
      <ambientLight intensity={arMode ? 0.4 : 0.3} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={arMode ? 0.8 : 1}
        castShadow={!arMode}
        shadow-mapSize-width={arMode ? 512 : 2048}
        shadow-mapSize-height={arMode ? 512 : 2048}
      />
      <directionalLight position={[-3, 4, -5]} intensity={0.4} />
      <pointLight position={[0, 5, 0]} intensity={0.5} color="#36cfc9" />

      {equipmentList && equipmentList.length > 0 ? (
        <FrustumCulledEquipment
          equipment={equipmentList}
          defects={defects}
          onEquipmentClick={onEquipmentClick}
          onLodChange={onLodChange}
          arMode={arMode}
          lodBias={perfMonitor.lodBias}
          maxHighResModels={maxHighResModels}
        />
      ) : (
        <mesh onClick={(e) => {
          e.stopPropagation();
          onModelClick?.({ x: e.point.x, y: e.point.y, z: e.point.z });
        }}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#1e3a5f" wireframe />
        </mesh>
      )}

      {defaultSensorPositions.map((s, i) => (
        <SensorHotspot key={i} {...s} />
      ))}

      {anchors.map((anchor, i) => (
        <AnchorMarker
          key={anchor.id || anchor.anchor_id || i}
          anchor={anchor}
          cameraPosition={camPos}
        />
      ))}

      {Object.entries(anomalyAlerts).map(([eqId, alert]) => {
        const eq = equipmentList.find((e) => e.id == eqId || e.qr_code == eqId);
        if (!eq) return null;
        return (
          <AnomalyHighlight
            key={eqId}
            position={[eq.position?.x || 0, eq.position?.y || 0, eq.position?.z || 0]}
            anomalyLevel={alert.level}
            anomalyScore={alert.score}
          />
        );
      })}

      {navigationPath && navigationPath.length > 1 && (
        <>
          <PathLine
            path={navigationPath.map((wp) => wp.position || wp)}
            waypointLabels={navigationPath.map((wp, i) => ({
              label: wp.name || `WP${i + 1}`,
              priority: wp.priority || 3,
            }))}
          />
          <NavigationArrow
            waypoints={navigationPath}
            currentWaypointIndex={0}
            userPosition={camPos}
          />
        </>
      )}

      <RemoteAnnotation />

      {!arMode && (
        <ContactShadows
          position={[0, -1, 0]}
          opacity={0.4}
          scale={10}
          blur={2}
          far={4}
        />
      )}

      <Environment preset="studio" />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={0.5}
        maxDistance={50}
        maxPolarAngle={Math.PI * 0.85}
      />

      {showPerformance && (
        <SceneStatsOverlay
          stats={{
            fps: perfMonitor.fps,
            memory: perfMonitor.memory,
            drawCalls,
            triangleCount,
            lodCounts,
            cameraPosition: camPos,
          }}
          arMode={arMode}
          onToggleAr={onToggleAr}
          isLowPerformance={perfMonitor.isLowPerformance}
        />
      )}

      {showPerformance && (
        <Stats
          showPanel={0}
          className="debug-stats"
          style={{
            position: 'absolute',
            top: 'auto',
            bottom: 10,
            left: 10,
            right: 'auto',
          }}
        />
      )}
    </group>
  );
}

function Loader() {
  return (
    <Html center>
      <Spin size="large" tip="加载3D场景..." />
    </Html>
  );
}

function ModelViewer({
  modelUrl,
  equipment = [],
  onModelClick,
  onEquipmentClick,
  defects = {},
  sensorData,
  arMode: externalArMode,
  lodBias: externalLodBias,
  showPerformance = false,
  anchors = [],
  anomalyAlerts = {},
  navigationPath = null,
  cameraPositionRef,
}) {
  const [internalArMode, setInternalArMode] = useState(false);
  const [lodCounts, setLodCounts] = useState({ high: 0, low: 0, billboard: 0 });

  const arMode = externalArMode !== undefined ? externalArMode : internalArMode;

  const perfMonitor = usePerformanceMonitor({
    fpsThreshold: 30,
    memoryThreshold: 0.85,
  });

  const effectiveLodBias = externalLodBias !== undefined ? externalLodBias : perfMonitor.lodBias;

  const overriddenPerfMonitor = useMemo(() => ({
    ...perfMonitor,
    lodBias: effectiveLodBias,
  }), [perfMonitor, effectiveLodBias]);

  const equipmentList = useMemo(() => {
    if (equipment && equipment.length > 0) {
      return equipment;
    }
    if (modelUrl) {
      return [{
        id: 'default',
        name: 'Default Equipment',
        modelUrl,
        highModelUrl: modelUrl,
        lowModelUrl: modelUrl,
        position: { x: 0, y: 0, z: 0 },
        status: 'online',
      }];
    }
    return [];
  }, [equipment, modelUrl]);

  const handleLodChange = useCallback(({ equipment, from, to }) => {
    setLodCounts(prev => {
      const next = { ...prev };
      if (from) next[from] = Math.max(0, next[from] - 1);
      if (to) next[to] = (next[to] || 0) + 1;
      return next;
    });
  }, []);

  const handleToggleAr = useCallback((checked) => {
    if (externalArMode === undefined) {
      setInternalArMode(checked);
    }
  }, [externalArMode]);

  useEffect(() => {
    return () => {
      if (equipmentList.length > 0) {
        useGLTF.clear();
      }
    };
  }, []);

  return (
    <div className="model-container">
      <Canvas
        camera={{ position: [2, 1.5, 2], fov: 50 }}
        shadows={!arMode}
        gl={{
          antialias: !arMode,
          alpha: false,
          powerPreference: arMode ? 'high-performance' : 'default',
        }}
        onCreated={({ gl }) => {
          gl.setClearColor('#0a1628');
          if (arMode) {
            gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
          }
        }}
        dpr={[1, arMode ? 1.5 : 2]}
      >
        <Suspense fallback={<Loader />}>
          <Scene
            equipmentList={equipmentList}
            onEquipmentClick={onEquipmentClick}
            onModelClick={onModelClick}
            defects={defects}
            sensorData={sensorData}
            arMode={arMode}
            onToggleAr={handleToggleAr}
            perfMonitor={overriddenPerfMonitor}
            onLodChange={handleLodChange}
            lodCounts={lodCounts}
            anchors={anchors}
            cameraPositionRef={cameraPositionRef}
            showPerformance={showPerformance}
            anomalyAlerts={anomalyAlerts}
            navigationPath={navigationPath}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

export default ModelViewer;
