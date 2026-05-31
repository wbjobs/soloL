import { create } from 'zustand';
import type { Position } from '../../shared/types';

export interface EditorSelection {
  anchor: Position;
  head: Position;
}

interface EditorState {
  cursorPosition: Position;
  selection: EditorSelection | null;
  isPlaying: boolean;
  playPosition: number;
  playbackSpeed: number;
  volume: number;
  isLoaded: boolean;
  error: string | null;
  setCursor: (position: Position) => void;
  setSelection: (selection: EditorSelection | null) => void;
  setPlaying: (isPlaying: boolean) => void;
  setPlayPosition: (position: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setVolume: (volume: number) => void;
  setLoaded: (loaded: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  cursorPosition: { line: 0, ch: 0 },
  selection: null,
  isPlaying: false,
  playPosition: 0,
  playbackSpeed: 1,
  volume: 0.8,
  isLoaded: false,
  error: null,
};

export const useEditorStore = create<EditorState>((set) => ({
  ...initialState,

  setCursor: (position: Position) => {
    set({ cursorPosition: position });
  },

  setSelection: (selection: EditorSelection | null) => {
    set({ selection });
  },

  setPlaying: (isPlaying: boolean) => {
    set({ isPlaying });
  },

  setPlayPosition: (position: number) => {
    set({ playPosition: Math.max(0, position) });
  },

  setPlaybackSpeed: (speed: number) => {
    const clampedSpeed = Math.max(0.25, Math.min(4, speed));
    set({ playbackSpeed: clampedSpeed });
  },

  setVolume: (volume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    set({ volume: clampedVolume });
  },

  setLoaded: (loaded: boolean) => {
    set({ isLoaded: loaded });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  reset: () => {
    set(initialState);
  },
}));

export const selectCursorPosition = (state: EditorState) => state.cursorPosition;
export const selectSelection = (state: EditorState) => state.selection;
export const selectIsPlaying = (state: EditorState) => state.isPlaying;
export const selectPlayPosition = (state: EditorState) => state.playPosition;
export const selectPlaybackSpeed = (state: EditorState) => state.playbackSpeed;
export const selectIsLoaded = (state: EditorState) => state.isLoaded;
export const selectEditorError = (state: EditorState) => state.error;
export const selectVolume = (state: EditorState) => state.volume;

export function useCursorPosition(): Position {
  return useEditorStore(selectCursorPosition);
}

export function useSelection(): EditorSelection | null {
  return useEditorStore(selectSelection);
}

export function useIsPlaying(): boolean {
  return useEditorStore(selectIsPlaying);
}

export function usePlayPosition(): number {
  return useEditorStore(selectPlayPosition);
}

export function usePlaybackSpeed(): number {
  return useEditorStore(selectPlaybackSpeed);
}

export function useIsLoaded(): boolean {
  return useEditorStore(selectIsLoaded);
}

export function useEditorError(): string | null {
  return useEditorStore(selectEditorError);
}

export function useVolume(): number {
  return useEditorStore(selectVolume);
}
