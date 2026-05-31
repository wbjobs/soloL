import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { TerrainLOD } from './TerrainLOD';
import { FluidParticles } from './FluidParticles';
import { PlaybackController } from './PlaybackController';
import { getSimulationManager } from '../ecs/SimulationManager';
import { useSimulationStore } from '../store/simulationStore';

function Scene() {
  const simulation = getSimulationManager();
  const isPaused = useSimulationStore((state) => state.isPaused);

  useEffect(() => {
    simulation.start();
    return () => simulation.stop();
  }, [simulation]);

  return (
    <>
      <PlaybackController />
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[10, 15, 10]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={50}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <pointLight position={[-5, 8, -5]} intensity={0.5} color="#64ffda" />
      
      <fog attach="fog" args={['#0a192f', 15, 40]} />
      
      <TerrainLOD />
      <FluidParticles />
      
      <Stars radius={100} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />
      
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={30}
        maxPolarAngle={Math.PI / 2.1}
        minPolarAngle={0.1}
      />
      
      <EffectComposer>
        <Bloom
          intensity={0.5}
          luminanceThreshold={0.2}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
      </EffectComposer>
    </>
  );
}

export function SimulationScene() {
  return (
    <Canvas
      camera={{ position: [8, 8, 8], fov: 60 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      dpr={[1, 2]}
      shadows
    >
      <color attach="background" args={['#0a192f']} />
      <Scene />
    </Canvas>
  );
}
