import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { usePlaybackStore } from '@/store/playbackStore';
import { getSimulationManager } from '@/ecs/SimulationManager';
import { useSimulationStore } from '@/store/simulationStore';

export function PlaybackController() {
  const simulation = getSimulationManager();
  const lastFrameRef = useRef(0);
  const {
    isRecording,
    isPlaying,
    currentFrame,
    totalFrames,
    playbackSpeed,
    addKeyframe,
    setCurrentFrame,
    stopPlayback,
    getKeyframeAtFrame,
  } = usePlaybackStore();

  const { setParams } = useSimulationStore();

  useFrame((_, delta) => {
    if (isPlaying) {
      const newFrame = Math.min(totalFrames, currentFrame + playbackSpeed * delta * 60);
      if (newFrame >= totalFrames) {
        stopPlayback();
        return;
      }
      setCurrentFrame(Math.floor(newFrame));

      const keyframe = getKeyframeAtFrame(Math.floor(newFrame));
      if (keyframe) {
        const heightMap = simulation.getHeightMap();
        const sedimentMap = simulation.getSedimentMap();
        heightMap.set(keyframe.heightMap);
        sedimentMap.set(keyframe.sedimentMap);
      }
    }
  });

  useEffect(() => {
    if (isPlaying) {
      setParams({ isPaused: true });
    }
  }, [isPlaying, setParams]);

  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      const heightMap = simulation.getHeightMap();
      const sedimentMap = simulation.getSedimentMap();
      const particleCount = simulation.getParticleCount();
      addKeyframe(heightMap, sedimentMap, particleCount);
    }, 100);

    return () => clearInterval(interval);
  }, [isRecording, simulation, addKeyframe]);

  return null;
}
