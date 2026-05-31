import { create } from 'zustand';
import type { User, LockedSection, ScoreVersion } from '../../shared/types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface CollaborationState {
  currentUser: User | null;
  users: User[];
  content: string;
  version: number;
  lockedSections: LockedSection[];
  versions: ScoreVersion[];
  connectionStatus: ConnectionStatus;
  error: string | null;
  setContent: (content: string) => void;
  addUser: (user: User) => void;
  removeUser: (userId: string) => void;
  updateUserCursor: (userId: string, cursor: { line: number; ch: number }, selection?: { anchor: { line: number; ch: number }; head: { line: number; ch: number } }) => void;
  lockSection: (section: LockedSection) => void;
  unlockSection: (sectionId: string) => void;
  addVersion: (version: ScoreVersion) => void;
  setConnectionStatus: (status: ConnectionStatus, error?: string) => void;
  setCurrentUser: (user: User) => void;
  setUsers: (users: User[]) => void;
  setVersion: (version: number) => void;
  setLockedSections: (sections: LockedSection[]) => void;
  setVersions: (versions: ScoreVersion[]) => void;
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  currentUser: null,
  users: [],
  content: '',
  version: 0,
  lockedSections: [],
  versions: [],
  connectionStatus: 'disconnected' as ConnectionStatus,
  error: null,
};

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  ...initialState,

  setContent: (content: string) => {
    set({ content });
  },

  addUser: (user: User) => {
    const { users } = get();
    const existingIndex = users.findIndex((u) => u.id === user.id);
    if (existingIndex === -1) {
      set({ users: [...users, user] });
    } else {
      const updatedUsers = [...users];
      updatedUsers[existingIndex] = user;
      set({ users: updatedUsers });
    }
  },

  removeUser: (userId: string) => {
    const { users, currentUser } = get();
    set({
      users: users.filter((u) => u.id !== userId),
    });
    if (currentUser?.id === userId) {
      set({ currentUser: null });
    }
  },

  updateUserCursor: (userId: string, cursor: { line: number; ch: number }, selection?: { anchor: { line: number; ch: number }; head: { line: number; ch: number } }) => {
    const { users } = get();
    const updatedUsers = users.map((user) => {
      if (user.id === userId) {
        return { ...user, cursor, selection };
      }
      return user;
    });
    set({ users: updatedUsers });
  },

  lockSection: (section: LockedSection) => {
    const { lockedSections } = get();
    const existingIndex = lockedSections.findIndex((s) => s.id === section.id);
    if (existingIndex === -1) {
      set({ lockedSections: [...lockedSections, section] });
    } else {
      const updatedSections = [...lockedSections];
      updatedSections[existingIndex] = section;
      set({ lockedSections: updatedSections });
    }
  },

  unlockSection: (sectionId: string) => {
    const { lockedSections } = get();
    set({
      lockedSections: lockedSections.filter((s) => s.id !== sectionId),
    });
  },

  addVersion: (version: ScoreVersion) => {
    const { versions } = get();
    const existingIndex = versions.findIndex((v) => v.id === version.id);
    if (existingIndex === -1) {
      set({
        versions: [version, ...versions].sort((a, b) => b.createdAt - a.createdAt),
        version: Math.max(get().version, version.version),
      });
    }
  },

  setConnectionStatus: (status: ConnectionStatus, error?: string) => {
    set({ connectionStatus: status, error: error ?? null });
  },

  setCurrentUser: (user: User) => {
    set({ currentUser: user });
  },

  setUsers: (users: User[]) => {
    set({ users });
  },

  setVersion: (version: number) => {
    set({ version });
  },

  setLockedSections: (sections: LockedSection[]) => {
    set({ lockedSections: sections });
  },

  setVersions: (versions: ScoreVersion[]) => {
    set({ versions: versions.sort((a, b) => b.createdAt - a.createdAt) });
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    set(initialState);
  },
}));
