import { create } from 'zustand';
import type { HistoryEntry } from '../types';

interface HistoryState {
  history: HistoryEntry[];
  currentIndex: number;
  maxHistorySize: number;
}

interface HistoryActions {
  push: (entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => void;
  undo: () => HistoryEntry | null;
  redo: () => HistoryEntry | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
  getCurrentEntry: () => HistoryEntry | null;
}

const generateId = (): string => {
  return `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const useHistoryStore = create<HistoryState & HistoryActions>((set, get) => ({
  history: [],
  currentIndex: -1,
  maxHistorySize: 50,

  push: (entry) =>
    set((state) => {
      const newEntry: HistoryEntry = {
        ...entry,
        id: generateId(),
        timestamp: new Date(),
      };

      const newHistory = state.history.slice(0, state.currentIndex + 1);
      newHistory.push(newEntry);

      if (newHistory.length > state.maxHistorySize) {
        newHistory.shift();
        return {
          history: newHistory,
          currentIndex: newHistory.length - 1,
        };
      }

      return {
        history: newHistory,
        currentIndex: newHistory.length - 1,
      };
    }),

  undo: () => {
    const state = get();
    if (state.currentIndex < 0) return null;

    const entry = state.history[state.currentIndex];
    set({ currentIndex: state.currentIndex - 1 });
    return entry;
  },

  redo: () => {
    const state = get();
    if (state.currentIndex >= state.history.length - 1) return null;

    const nextIndex = state.currentIndex + 1;
    const entry = state.history[nextIndex];
    set({ currentIndex: nextIndex });
    return entry;
  },

  canUndo: () => {
    const state = get();
    return state.currentIndex >= 0;
  },

  canRedo: () => {
    const state = get();
    return state.currentIndex < state.history.length - 1;
  },

  clear: () =>
    set({
      history: [],
      currentIndex: -1,
    }),

  getCurrentEntry: () => {
    const state = get();
    if (state.currentIndex < 0 || state.currentIndex >= state.history.length) {
      return null;
    }
    return state.history[state.currentIndex];
  },
}));
