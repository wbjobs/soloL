import { create } from 'zustand';
import type { ProofreadBlock } from '../types';

interface PlayerState {
  currentTime: number;
  duration: number;
  playbackRate: number;
  isPlaying: boolean;
  activeBlockIndex: number;
  loopCurrentBlock: boolean;
  seekToCallback: ((time: number) => void) | null;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaybackRate: (rate: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setActiveBlockIndex: (index: number) => void;
  setLoopCurrentBlock: (loop: boolean) => void;
  setSeekToCallback: (cb: ((time: number) => void) | null) => void;
  seekTo: (time: number) => void;
  findActiveBlockIndex: (blocks: ProofreadBlock[]) => number;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  isPlaying: false,
  activeBlockIndex: 0,
  loopCurrentBlock: false,
  seekToCallback: null,

  setCurrentTime: (time) => set({ currentTime: time }),

  setDuration: (duration) => set({ duration }),

  setPlaybackRate: (rate) => set({ playbackRate: rate }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setActiveBlockIndex: (index) => set({ activeBlockIndex: index }),

  setLoopCurrentBlock: (loop) => set({ loopCurrentBlock: loop }),

  setSeekToCallback: (cb) => set({ seekToCallback: cb }),

  seekTo: (time) => {
    const { seekToCallback } = get();
    if (seekToCallback) {
      seekToCallback(time);
    }
  },

  findActiveBlockIndex: (blocks) => {
    const { currentTime } = get();
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (currentTime >= blocks[i].startTime) {
        return i;
      }
    }
    return 0;
  },
}));
