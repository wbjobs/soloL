import { create } from 'zustand';
import type { AISuggestion } from '../types';
import {
  getAISuggestions, generateAISuggestions, adoptSuggestion, rejectSuggestion } from '../api/ai';

interface AISuggestionStore {
  suggestions: AISuggestion[];
  loading: boolean;
  generating: boolean;
  error: string | null;
  fetchSuggestions: (projectId: string) => Promise<void>;
  generateSuggestions: (projectId: string, options?: { language?: string; model?: string; userId?: string }) => Promise<void>;
  adopt: (suggestionId: string, userId: string) => Promise<void>;
  reject: (suggestionId: string, userId: string) => Promise<void>;
  getSuggestionForBlock: (blockIndex: number) => AISuggestion | undefined;
  clearSuggestions: () => void;
}

export const useAISuggestionStore = create<AISuggestionStore>((set, get) => ({
  suggestions: [],
  loading: false,
  generating: false,
  error: null,

  fetchSuggestions: async (projectId: string) => {
    set({ loading: true, error: null });
    try {
      const suggestions = await getAISuggestions(projectId);
      set({ suggestions, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  generateSuggestions: async (projectId: string, options?: { language?: string; model?: string; userId?: string }) => {
    set({ generating: true, error: null });
    try {
      const suggestions = await generateAISuggestions(projectId, options);
      set({ suggestions, generating: false });
    } catch (err) {
      set({ error: (err as Error).message, generating: false });
    }
  },

  adopt: async (suggestionId: string, userId: string) => {
    try {
      await adoptSuggestion(suggestionId, userId);
      set((state) => ({
        suggestions: state.suggestions.map((s) =>
        s.id === suggestionId ? { ...s, status: 'accepted', adoptedBy: userId } : s,
      ) as AISuggestion[],
    }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  reject: async (suggestionId: string, userId: string) => {
    try {
      await rejectSuggestion(suggestionId, userId);
      set((state) => ({
        suggestions: state.suggestions.map((s) =>
        s.id === suggestionId ? { ...s, status: 'rejected' } : s,
      ) as AISuggestion[],
    }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  getSuggestionForBlock: (blockIndex: number) => {
    return get().suggestions.find((s) => s.blockIndex === blockIndex && s.status === 'pending');
  },

  clearSuggestions: () => {
    set({ suggestions: [] });
  },
}));
