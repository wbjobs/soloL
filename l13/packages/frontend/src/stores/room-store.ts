import { create } from 'zustand';
import type { Participant, CursorPosition } from '../types';

interface RoomState {
  roomId: string | null;
  participants: Participant[];
  cursors: Map<string, CursorPosition>;
  connected: boolean;
  setRoomId: (id: string | null) => void;
  setParticipants: (participants: Participant[]) => void;
  addParticipant: (participant: Participant) => void;
  removeParticipant: (userId: string) => void;
  updateParticipantOnline: (userId: string, isOnline: boolean) => void;
  setCursor: (userId: string, cursor: CursorPosition) => void;
  removeCursor: (userId: string) => void;
  setConnected: (connected: boolean) => void;
  reset: () => void;
}

const initialState = {
  roomId: null,
  participants: [],
  cursors: new Map<string, CursorPosition>(),
  connected: false,
};

export const useRoomStore = create<RoomState>((set) => ({
  ...initialState,

  setRoomId: (id) => set({ roomId: id }),

  setParticipants: (participants) => set({ participants }),

  addParticipant: (participant) =>
    set((state) => ({
      participants: [...state.participants, participant],
    })),

  removeParticipant: (userId) =>
    set((state) => ({
      participants: state.participants.filter((p) => p.id !== userId),
      cursors: new Map([...state.cursors.entries()].filter(([k]) => k !== userId)),
    })),

  updateParticipantOnline: (userId, isOnline) =>
    set((state) => ({
      participants: state.participants.map((p) =>
        p.id === userId ? { ...p, isOnline } : p,
      ),
    })),

  setCursor: (userId, cursor) =>
    set((state) => {
      const newCursors = new Map(state.cursors);
      newCursors.set(userId, cursor);
      return { cursors: newCursors };
    }),

  removeCursor: (userId) =>
    set((state) => {
      const newCursors = new Map(state.cursors);
      newCursors.delete(userId);
      return { cursors: newCursors };
    }),

  setConnected: (connected) => set({ connected }),

  reset: () => set(initialState),
}));
