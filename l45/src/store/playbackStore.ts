import { create } from 'zustand';

export interface Keyframe {
  frame: number;
  timestamp: number;
  heightMap: Float32Array;
  sedimentMap: Float32Array;
  particleCount: number;
}

export interface PlaybackState {
  isRecording: boolean;
  isPlaying: boolean;
  currentFrame: number;
  totalFrames: number;
  keyframes: Keyframe[];
  recordingStartTime: number;
  playbackSpeed: number;

  startRecording: () => void;
  stopRecording: () => void;
  addKeyframe: (heightMap: Float32Array, sedimentMap: Float32Array, particleCount: number) => void;
  startPlayback: () => void;
  stopPlayback: () => void;
  setCurrentFrame: (frame: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  clearRecording: () => void;
  getKeyframeAtFrame: (frame: number) => Keyframe | null;
}

const MAX_KEYFRAMES = 300;
const KEYFRAME_INTERVAL = 10;

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  isRecording: false,
  isPlaying: false,
  currentFrame: 0,
  totalFrames: 0,
  keyframes: [],
  recordingStartTime: 0,
  playbackSpeed: 1,

  startRecording: () => {
    set({
      isRecording: true,
      isPlaying: false,
      currentFrame: 0,
      totalFrames: 0,
      keyframes: [],
      recordingStartTime: performance.now(),
    });
  },

  stopRecording: () => {
    set({ isRecording: false });
  },

  addKeyframe: (heightMap: Float32Array, sedimentMap: Float32Array, particleCount: number) => {
    const state = get();
    if (!state.isRecording) return;
    if (state.keyframes.length >= MAX_KEYFRAMES) return;

    const newFrame = state.totalFrames + 1;
    if (newFrame % KEYFRAME_INTERVAL !== 0) {
      set({ totalFrames: newFrame });
      return;
    }

    const keyframe: Keyframe = {
      frame: newFrame,
      timestamp: performance.now() - state.recordingStartTime,
      heightMap: new Float32Array(heightMap),
      sedimentMap: new Float32Array(sedimentMap),
      particleCount,
    };

    set((state) => ({
      keyframes: [...state.keyframes, keyframe],
      totalFrames: newFrame,
    }));
  },

  startPlayback: () => {
    const state = get();
    if (state.keyframes.length < 2) return;
    set({ isPlaying: true, isRecording: false, currentFrame: 0 });
  },

  stopPlayback: () => {
    set({ isPlaying: false });
  },

  setCurrentFrame: (frame: number) => {
    set({ currentFrame: frame });
  },

  setPlaybackSpeed: (speed: number) => {
    set({ playbackSpeed: speed });
  },

  clearRecording: () => {
    set({
      isRecording: false,
      isPlaying: false,
      currentFrame: 0,
      totalFrames: 0,
      keyframes: [],
    });
  },

  getKeyframeAtFrame: (frame: number): Keyframe | null => {
    const state = get();
    if (state.keyframes.length === 0) return null;

    let left = 0;
    let right = state.keyframes.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (state.keyframes[mid].frame === frame) {
        return state.keyframes[mid];
      } else if (state.keyframes[mid].frame < frame) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    if (right < 0) return state.keyframes[0];
    if (left >= state.keyframes.length) return state.keyframes[state.keyframes.length - 1];

    const kf1 = state.keyframes[right];
    const kf2 = state.keyframes[left];
    const t = (frame - kf1.frame) / (kf2.frame - kf1.frame || 1);

    const interpolatedHeightMap = new Float32Array(kf1.heightMap.length);
    const interpolatedSedimentMap = new Float32Array(kf1.sedimentMap.length);

    for (let i = 0; i < kf1.heightMap.length; i++) {
      interpolatedHeightMap[i] = kf1.heightMap[i] * (1 - t) + kf2.heightMap[i] * t;
      interpolatedSedimentMap[i] = kf1.sedimentMap[i] * (1 - t) + kf2.sedimentMap[i] * t;
    }

    return {
      frame,
      timestamp: kf1.timestamp * (1 - t) + kf2.timestamp * t,
      heightMap: interpolatedHeightMap,
      sedimentMap: interpolatedSedimentMap,
      particleCount: Math.round(kf1.particleCount * (1 - t) + kf2.particleCount * t),
    };
  },
}));
