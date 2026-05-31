import { create } from 'zustand'
import type { Settings, PeerInfo } from '../../types'

interface SettingsState {
  settings: Partial<Settings>
  peers: PeerInfo[]
  syncEnabled: boolean
  dbStats: { totalCount: number; size: number }

  setSettings: (settings: Partial<Settings>) => void
  setPeers: (peers: PeerInfo[]) => void
  setSyncEnabled: (enabled: boolean) => void
  setDbStats: (stats: { totalCount: number; size: number }) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {},
  peers: [],
  syncEnabled: false,
  dbStats: { totalCount: 0, size: 0 },

  setSettings: (settings) => set({ settings }),
  setPeers: (peers) => set({ peers }),
  setSyncEnabled: (syncEnabled) => set({ syncEnabled }),
  setDbStats: (dbStats) => set({ dbStats })
}))
