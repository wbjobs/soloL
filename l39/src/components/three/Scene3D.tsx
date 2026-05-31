import { useRef, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { EffectComposer, Bloom, FXAA } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useStore } from '../../store/useStore';
import { GeologicalModel } from './GeologicalModel';
import { WellTrajectory3D } from './WellTrajectory3D';
import { SlicePlane3D } from './SlicePlane3D';
import { PotreePointCloud } from './PotreePointCloud';
import { AnnotationLayer, RemoteCursors } from './AnnotationLayer';
import { FlowSimulationVisualization, ProductionChart } from './FlowSimulationVisualization';

interface SceneContentProps {
  currentView: 'perspective' | 'top' | 'front' | 'side';
}

function SceneContent({ currentView }: SceneContentProps) {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  
  const {
    grid,
    gridId,
    formations,
    trajectories,
    selectedTrajectoryId,
    sliceParams,
    showSlice,
    showModel,
    showTrajectories,
    showWireframe,
    opacity,
    usePotree,
    lodThreshold,
    maxVisiblePoints,
    pointSize,
    simulationResult,
    showSimulation,
    annotations,
    showAnnotations,
    remoteCursors
  } = useStore();

  useEffect(() => {
    if (!grid) return;
    
    const { dimensions, origin, spacing } = grid;
    const centerX = origin.x + (dimensions.nx - 1) * spacing.x / 2;
    const centerY = origin.y + (dimensions.ny - 1) * spacing.y / 2;
    const centerZ = origin.z + (dimensions.nz - 1) * spacing.z / 2;
    const maxSize = Math.max(
      (dimensions.nx - 1) * spacing.x,
      (dimensions.ny - 1) * spacing.y,
      (dimensions.nz - 1) * spacing.z
    );

    const distance = maxSize * 2;

    switch (currentView) {
      case 'top':
        camera.position.set(centerX, centerY, centerZ + distance);
        break;
      case 'front':
        camera.position.set(centerX, centerY - distance, centerZ);
        break;
      case 'side':
        camera.position.set(centerX + distance, centerY, centerZ);
        break;
      default:
        camera.position.set(
          centerX + distance * 0.7,
          centerY - distance * 0.7,
          centerZ + distance * 0.5
        );
    }

    if (controlsRef.current) {
      controlsRef.current.target.set(centerX, centerY, centerZ);
      controlsRef.current.update();
    }
  }, [currentView, grid, camera]);

  useFrame(() => {
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[500, -500, 500]} fov={45} />
      
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.05}
        minDistance={50}
        maxDistance={3000}
      />

      <ambientLight intensity={0.4} />
      <directionalLight
        position={[500, -500, 800]}
        intensity={1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight
        position={[-300, 300, 400]}
        intensity={0.5}
        color="#87ceeb"
      />
      <pointLight position={[0, 0, 300]} intensity={0.3} color="#ff6b35" />

      <Environment preset="night" />

      {grid && (
        <Grid
          position={[
            grid.origin.x + (grid.dimensions.nx - 1) * grid.spacing.x / 2,
            grid.origin.y + (grid.dimensions.ny - 1) * grid.spacing.y / 2,
            grid.origin.z - 5
          ]}
          args={[
            (grid.dimensions.nx - 1) * grid.spacing.x,
            (grid.dimensions.ny - 1) * grid.spacing.y
          ]}
          cellSize={50}
          cellThickness={0.5}
          cellColor="#2d3748"
          sectionSize={200}
          sectionThickness={1}
          sectionColor="#4a5568"
          fadeDistance={2000}
          fadeStrength={1}
          followCamera={false}
        />
      )}

      {grid && showModel && (
        usePotree ? (
          gridId && <PotreePointCloud
            gridId={gridId}
            pointSize={pointSize}
            maxVisiblePoints={maxVisiblePoints}
            lodThreshold={lodThreshold}
            showBoundingBox={false}
          />
        ) : (
          <GeologicalModel
            grid={grid}
            formations={formations}
            opacity={opacity}
            showWireframe={showWireframe}
          />
        )
      )}

      {grid && gridId && showSlice && (
        <SlicePlane3D
          gridId={gridId}
          params={sliceParams}
          grid={grid}
          formations={formations}
        />
      )}

      {showTrajectories && trajectories.map((trajectory) => (
        <WellTrajectory3D
          key={trajectory.id}
          trajectory={trajectory}
          isSelected={trajectory.id === selectedTrajectoryId}
          showControlPoints={true}
        />
      ))}

      {showSimulation && simulationResult && grid && (
        <>
          <FlowSimulationVisualization
            simulationResult={simulationResult}
            grid={grid}
          />
          <ProductionChart simulationResult={simulationResult} />
        </>
      )}

      {showAnnotations && annotations.length > 0 && (
        <AnnotationLayer annotations={annotations} />
      )}

      {remoteCursors.size > 0 && (
        <RemoteCursors cursors={remoteCursors} />
      )}

      <axesHelper args={[100]} position={[-450, -450, 0]} />

      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={['#ff6b35', '#4ecdc4', '#45b7d1']} labelColor="white" />
      </GizmoHelper>

      <EffectComposer>
        <FXAA />
        <Bloom
          luminanceThreshold={0.2}
          luminanceSmoothing={0.9}
          intensity={0.5}
        />
      </EffectComposer>

      <fog attach="fog" args={['#0a0a1a', 500, 3000]} />
    </>
  );
}

interface Scene3DProps {
  className?: string;
}

export function Scene3D({ className }: Scene3DProps) {
  const currentView = useStore((state) => state.currentView);

  return (
    <div className={className}>
      <Canvas
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        style={{ background: 'linear-gradient(to bottom, #0a0a1a, #1a1a2e)' }}
      >
        <color attach="background" args={['#0a0a1a']} />
        <SceneContent currentView={currentView} />
      </Canvas>
    </div>
  );
}
