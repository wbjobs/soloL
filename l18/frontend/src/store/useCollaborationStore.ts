import { create } from 'zustand';
import type { ControversialPoint, QualityAssessment, CollaborativeSession, LabelOperation } from '../services/collaboration';

interface CollaborationState {
  controversialPoints: ControversialPoint[];
  qualityAssessments: QualityAssessment[];
  currentSession: CollaborativeSession | null;
  activeSessions: CollaborativeSession[];
  remoteOperations: LabelOperation[];
  lamportClock: number;
  isPolling: boolean;
  pollingInterval: number | null;
  
  setControversialPoints: (points: ControversialPoint[]) => void;
  setQualityAssessments: (assessments: QualityAssessment[]) => void;
  setCurrentSession: (session: CollaborativeSession | null) => void;
  setActiveSessions: (sessions: CollaborativeSession[]) => void;
  addRemoteOperations: (operations: LabelOperation[]) => void;
  setLamportClock: (clock: number) => void;
  setIsPolling: (isPolling: boolean) => void;
  setPollingInterval: (interval: number | null) => void;
  reset: () => void;
}

export const useCollaborationStore = create<CollaborationState>((set) => ({
  controversialPoints: [],
  qualityAssessments: [],
  currentSession: null,
  activeSessions: [],
  remoteOperations: [],
  lamportClock: 0,
  isPolling: false,
  pollingInterval: null,

  setControversialPoints: (points) => set({ controversialPoints: points }),
  setQualityAssessments: (assessments) => set({ qualityAssessments: assessments }),
  setCurrentSession: (session) => set({ currentSession: session }),
  setActiveSessions: (sessions) => set({ activeSessions: sessions }),
  addRemoteOperations: (operations) => set((state) => ({
    remoteOperations: [...state.remoteOperations, ...operations],
  })),
  setLamportClock: (clock) => set({ lamportClock: clock }),
  setIsPolling: (isPolling) => set({ isPolling }),
  setPollingInterval: (interval) => set({ pollingInterval: interval }),
  
  reset: () => set({
    controversialPoints: [],
    qualityAssessments: [],
    currentSession: null,
    activeSessions: [],
    remoteOperations: [],
    lamportClock: 0,
    isPolling: false,
    pollingInterval: null,
  }),
}));

export default useCollaborationStore;
