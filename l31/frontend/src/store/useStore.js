import { create } from 'zustand'
import { midiAPI, annotationsAPI } from '../services/api'
import wsService from '../services/websocket'
import chordModel from '../services/chordModel'
import localDB from '../services/localDB'

const useStore = create((set, get) => ({
  midiFiles: [],
  selectedMidiId: null,
  selectedMidi: null,
  annotations: [],
  annotationVersion: 0,
  visibleNotes: [],
  loadedSlices: [],
  viewportTimeRange: { start: 0, end: 10 },
  spectrumData: null,
  loading: false,
  loadingNotes: false,
  error: null,
  username: localStorage.getItem('username') || 'User_' + Math.random().toString(36).substr(2, 5),
  userId: localStorage.getItem('userId') || 'user_' + Math.random().toString(36).substr(2, 9),
  onlineUsers: [],
  remoteCursors: {},
  activeTab: '3d',
  timePosition: 0,
  isPlaying: false,
  playbackSpeed: 1,
  trackVisibility: {},
  useFrustumCulling: true,
  dynamicLoading: true,

  modelTraining: false,
  modelTrained: false,
  chordPredictions: [],
  predictedChord: null,

  selectedTimeRange: null,
  selectionNotes: [],

  annotationHistory: [],
  historyVersion: null,
  isTimeTravelMode: false,

  operationLogs: [],

  setUsername: (name) => {
    localStorage.setItem('username', name)
    set({ username: name })
  },

  loadMidiFiles: async () => {
    set({ loading: true })
    try {
      const files = await midiAPI.list()
      set({ midiFiles: files })
    } catch (error) {
      set({ error: error.message })
    } finally {
      set({ loading: false })
    }
  },

  uploadMidi: async (file) => {
    set({ loading: true })
    try {
      const result = await midiAPI.upload(file)
      await get().loadMidiFiles()
      return result
    } catch (error) {
      set({ error: error.message })
      throw error
    } finally {
      set({ loading: false })
    }
  },

  selectMidi: async (midiId) => {
    if (get().selectedMidiId === midiId) return

    wsService.disconnect()
    set({
      selectedMidiId: midiId,
      selectedMidi: null,
      annotations: [],
      annotationVersion: 0,
      visibleNotes: [],
      loadedSlices: [],
      spectrumData: null,
      loading: true
    })

    try {
      const [midi, annotations] = await Promise.all([
        midiAPI.getDetail(midiId),
        annotationsAPI.list(midiId)
      ])

      const visibility = {}
      midi.tracks.forEach(track => {
        visibility[track.id] = true
      })

      const initialVersion = annotations.length > 0 
        ? Math.max(...annotations.map(a => a.version || 0))
        : 0

      set({
        selectedMidi: midi,
        annotations,
        annotationVersion: initialVersion,
        trackVisibility: visibility,
        timePosition: 0,
        isPlaying: false,
        viewportTimeRange: { start: 0, end: Math.min(midi.total_duration, 30) }
      })

      wsService.setVersion(initialVersion)

      const { userId, username } = get()
      wsService.connect(midiId, userId, username, initialVersion)

      wsService.on('user_list', (data) => {
        set({ onlineUsers: data.data.users })
      })

      wsService.on('annotations_updated', ({ deltas, version }) => {
        set(state => {
          let newAnnotations = [...state.annotations]
          
          for (const delta of deltas) {
            if (delta.operation === 'create') {
              const exists = newAnnotations.find(a => a.id === delta.data.id)
              if (!exists) {
                newAnnotations.unshift(delta.data)
              }
            } else if (delta.operation === 'update') {
              newAnnotations = newAnnotations.map(a =>
                a.id === delta.data.id ? delta.data : a
              )
            } else if (delta.operation === 'delete') {
              newAnnotations = newAnnotations.filter(a => a.id !== delta.data.id)
            }
          }

          return {
            annotations: newAnnotations,
            annotationVersion: version
          }
        })
      })

      wsService.on('cursor_update', (data) => {
        if (data.data.user_id !== get().userId) {
          set(state => ({
            remoteCursors: {
              ...state.remoteCursors,
              [data.data.user_id]: {
                username: data.data.username,
                position: data.data.position,
                time: data.data.time,
                lastUpdate: Date.now()
              }
            }
          }))
        }
      })

      if (get().dynamicLoading) {
        await get().loadVisibleNotes(0, Math.min(midi.total_duration, 30))
      }

    } catch (error) {
      set({ error: error.message })
    } finally {
      set({ loading: false })
    }
  },

  loadVisibleNotes: async (startTime, endTime, preloadBuffer = 2) => {
    const { selectedMidiId, dynamicLoading } = get()
    if (!selectedMidiId || !dynamicLoading) return

    set({ loadingNotes: true })
    try {
      const result = await midiAPI.getVisibleNotes(selectedMidiId, startTime, endTime, preloadBuffer)
      set({
        visibleNotes: result.visible_notes,
        loadedSlices: result.slice_indices,
        viewportTimeRange: { start: startTime, end: endTime }
      })
    } catch (error) {
      set({ error: error.message })
    } finally {
      set({ loadingNotes: false })
    }
  },

  updateViewport: async (startTime, endTime) => {
    const { viewportTimeRange, loadedSlices, dynamicLoading, selectedMidi } = get()
    if (!dynamicLoading || !selectedMidi) return

    const sliceDuration = 2
    const startSlice = Math.floor(startTime / sliceDuration)
    const endSlice = Math.floor(endTime / sliceDuration)

    const needsLoad = startSlice < Math.min(...loadedSlices) || 
                      endSlice > Math.max(...loadedSlices) ||
                      loadedSlices.length === 0

    if (needsLoad) {
      const bufferStart = Math.max(0, startTime - sliceDuration * 2)
      const bufferEnd = Math.min(selectedMidi.total_duration, endTime + sliceDuration * 2)
      await get().loadVisibleNotes(bufferStart, bufferEnd)
    } else {
      set({ viewportTimeRange: { start: startTime, end: endTime } })
    }
  },

  loadSpectrum: async () => {
    const { selectedMidiId } = get()
    if (!selectedMidiId) return

    set({ loading: true })
    try {
      const spectrum = await midiAPI.getSpectrum(selectedMidiId)
      set({ spectrumData: spectrum })
    } catch (error) {
      set({ error: error.message })
    } finally {
      set({ loading: false })
    }
  },

  createAnnotation: async (annotation) => {
    try {
      const { annotationVersion } = get()
      const result = await annotationsAPI.create(annotation, annotationVersion)
      wsService.setVersion(result.version)
      return result
    } catch (error) {
      set({ error: error.message })
      throw error
    }
  },

  updateAnnotation: async (annotationId, update) => {
    try {
      const result = await annotationsAPI.update(annotationId, update)
      wsService.setVersion(result.version)
      return result
    } catch (error) {
      set({ error: error.message })
      throw error
    }
  },

  deleteAnnotation: async (annotationId) => {
    try {
      const result = await annotationsAPI.delete(annotationId)
      if (result.version) {
        wsService.setVersion(result.version)
      }
    } catch (error) {
      set({ error: error.message })
      throw error
    }
  },

  setActiveTab: (tab) => {
    if (tab === 'spectrum' && !get().spectrumData) {
      get().loadSpectrum()
    }
    set({ activeTab: tab })
  },

  setTimePosition: (time) => set({ timePosition: time }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

  toggleTrackVisibility: (trackId) => {
    set(state => ({
      trackVisibility: {
        ...state.trackVisibility,
        [trackId]: !state.trackVisibility[trackId]
      }
    }))
  },

  toggleFrustumCulling: () => {
    set(state => ({ useFrustumCulling: !state.useFrustumCulling }))
  },

  toggleDynamicLoading: () => {
    set(state => ({ dynamicLoading: !state.dynamicLoading }))
  },

  sendCursorPosition: (position, time) => {
    if (wsService.isConnected()) {
      wsService.sendCursorUpdate(position, time)
    }
  },

  getAllNotes: () => {
    const { selectedMidi, dynamicLoading, visibleNotes } = get()
    if (dynamicLoading) {
      return visibleNotes
    }
    return selectedMidi?.notes || []
  },

  clearError: () => set({ error: null }),

  setSelectedTimeRange: (startTime, endTime) => {
    const allNotes = get().getAllNotes()
    const selectionNotes = allNotes.filter(n =>
      n.start_time >= startTime && n.start_time < endTime
    )
    set({
      selectedTimeRange: { start: startTime, end: endTime },
      selectionNotes
    })
  },

  clearSelection: () => {
    set({
      selectedTimeRange: null,
      selectionNotes: [],
      chordPredictions: [],
      predictedChord: null
    })
  },

  trainChordModel: async (epochs = 50) => {
    const { annotations, getAllNotes } = get()
    if (annotations.length < 5) {
      throw new Error('Need at least 5 chord annotations to train')
    }

    set({ modelTraining: true })
    try {
      const allNotes = getAllNotes()
      const count = chordModel.addTrainingExamplesFromAnnotations(annotations, allNotes)
      console.log(`Added ${count} training examples`)
      
      const history = await chordModel.train(epochs)
      set({ modelTrained: true })
      return history
    } finally {
      set({ modelTraining: false })
    }
  },

  predictChord: async () => {
    const { selectionNotes, modelTrained } = get()
    if (!modelTrained || selectionNotes.length === 0) return null

    const predictions = chordModel.predict(selectionNotes)
    set({
      chordPredictions: predictions?.predictions || [],
      predictedChord: predictions?.top || null
    })
    return predictions
  },

  saveModel: async () => {
    return await chordModel.saveModel()
  },

  loadModel: async () => {
    const loaded = await chordModel.loadModel()
    if (loaded) {
      set({ modelTrained: true })
    }
    return loaded
  },

  getModelStats: () => {
    return chordModel.getTrainingStats()
  },

  resetModel: () => {
    chordModel.resetModel()
    set({ modelTrained: false, modelTraining: false })
  },

  logOperation: async (type, data) => {
    const { selectedMidiId, username } = get()
    await localDB.logOperation({
      midi_id: selectedMidiId,
      type,
      data,
      user: username
    })
    await get().loadOperationLogs()
  },

  loadOperationLogs: async () => {
    const { selectedMidiId } = get()
    const logs = await localDB.getOperationLogs(selectedMidiId, 100)
    set({ operationLogs: logs })
  },

  clearOperationLogs: async () => {
    const { selectedMidiId } = get()
    await localDB.clearOperationLogs(selectedMidiId)
    set({ operationLogs: [] })
  },

  saveAnnotationSnapshot: async () => {
    const { selectedMidiId, annotations, annotationVersion } = get()
    if (!selectedMidiId) return
    
    await localDB.saveAnnotationSnapshot(
      selectedMidiId,
      annotations,
      annotationVersion
    )
    await get().loadAnnotationHistory()
  },

  loadAnnotationHistory: async () => {
    const { selectedMidiId } = get()
    if (!selectedMidiId) return
    
    const history = await localDB.getAnnotationHistory(selectedMidiId)
    set({ annotationHistory: history })
  },

  jumpToHistoryVersion: async (version) => {
    const { selectedMidiId } = get()
    if (!selectedMidiId) return
    
    const snapshot = await localDB.getSnapshotByVersion(selectedMidiId, version)
    if (snapshot) {
      set({
        annotations: snapshot.annotations,
        historyVersion: version,
        isTimeTravelMode: true
      })
    }
  },

  exitTimeTravelMode: async () => {
    const { selectedMidiId, annotationVersion } = get()
    if (!selectedMidiId) return
    
    const latest = await localDB.getLatestSnapshot(selectedMidiId)
    set({
      annotations: latest ? latest.annotations : [],
      annotationVersion: latest ? latest.version : annotationVersion,
      historyVersion: null,
      isTimeTravelMode: false
    })
  },

  clearOldHistory: async (keepLatest = 20) => {
    const { selectedMidiId } = get()
    if (!selectedMidiId) return
    
    await localDB.clearHistory(selectedMidiId, keepLatest)
    await get().loadAnnotationHistory()
  }
}))

export default useStore
