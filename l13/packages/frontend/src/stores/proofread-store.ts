import { create } from 'zustand';
import type { ProofreadBlock } from '../types';

interface ProofreadState {
  blocks: ProofreadBlock[];
  activeBlockIndex: number;
  loading: boolean;
  setBlocks: (blocks: ProofreadBlock[]) => void;
  setActiveBlockIndex: (index: number) => void;
  updateBlock: (blockId: string, updates: Partial<ProofreadBlock>) => void;
  insertBlock: (block: ProofreadBlock, index: number) => void;
  removeBlock: (blockId: string) => void;
  setLoading: (loading: boolean) => void;
  getActiveBlock: () => ProofreadBlock | undefined;
}

export const useProofreadStore = create<ProofreadState>((set, get) => ({
  blocks: [],
  activeBlockIndex: -1,
  loading: false,

  setBlocks: (blocks) => set({ blocks }),

  setActiveBlockIndex: (index) => set({ activeBlockIndex: index }),

  updateBlock: (blockId, updates) =>
    set((state) => ({
      blocks: state.blocks.map((b) =>
        b.id === blockId ? { ...b, ...updates } : b,
      ),
    })),

  insertBlock: (block, index) =>
    set((state) => {
      const newBlocks = [...state.blocks];
      newBlocks.splice(index, 0, block);
      return { blocks: newBlocks };
    }),

  removeBlock: (blockId) =>
    set((state) => ({
      blocks: state.blocks.filter((b) => b.id !== blockId),
    })),

  setLoading: (loading) => set({ loading }),

  getActiveBlock: () => {
    const { blocks, activeBlockIndex } = get();
    if (activeBlockIndex < 0 || activeBlockIndex >= blocks.length) return undefined;
    return blocks[activeBlockIndex];
  },
}));
