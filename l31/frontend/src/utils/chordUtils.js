export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const CHORD_TYPES = {
  'major': { name: '大和弦', intervals: [0, 4, 7], symbol: '' },
  'minor': { name: '小和弦', intervals: [0, 3, 7], symbol: 'm' },
  'dim': { name: '减和弦', intervals: [0, 3, 6], symbol: 'dim' },
  'aug': { name: '增和弦', intervals: [0, 4, 8], symbol: 'aug' },
  'sus2': { name: '挂二和弦', intervals: [0, 2, 7], symbol: 'sus2' },
  'sus4': { name: '挂四和弦', intervals: [0, 5, 7], symbol: 'sus4' },
  '7': { name: '属七和弦', intervals: [0, 4, 7, 10], symbol: '7' },
  'maj7': { name: '大七和弦', intervals: [0, 4, 7, 11], symbol: 'maj7' },
  'm7': { name: '小七和弦', intervals: [0, 3, 7, 10], symbol: 'm7' },
  'm7b5': { name: '半减七和弦', intervals: [0, 3, 6, 10], symbol: 'm7b5' },
  'dim7': { name: '减七和弦', intervals: [0, 3, 6, 9], symbol: 'dim7' }
}

export const CHORD_LABELS = []
export const CHORD_TO_INDEX = {}
export const INDEX_TO_CHORD = {}

let index = 0
NOTE_NAMES.forEach(root => {
  Object.keys(CHORD_TYPES).forEach(type => {
    const label = `${root}${CHORD_TYPES[type].symbol}`
    CHORD_LABELS.push(label)
    CHORD_TO_INDEX[label] = index
    INDEX_TO_CHORD[index] = { root, type, label }
    index++
  })
})

export const NUM_CHORDS = CHORD_LABELS.length
export const NUM_PITCH_CLASSES = 12

export function noteToPitchClass(midiNote) {
  return midiNote % 12
}

export function notesToPitchClassVector(notes) {
  const vector = new Array(NUM_PITCH_CLASSES).fill(0)
  notes.forEach(note => {
    const pc = noteToPitchClass(note.pitch)
    vector[pc] = Math.max(vector[pc], note.velocity / 127.0)
  })
  return vector
}

export function notesToChromaMatrix(notes, duration = 4, binsPerSecond = 4) {
  const numBins = Math.ceil(duration * binsPerSecond)
  const matrix = []
  
  for (let i = 0; i < numBins; i++) {
    const binStart = i / binsPerSecond
    const binEnd = (i + 1) / binsPerSecond
    const binVector = new Array(NUM_PITCH_CLASSES).fill(0)
    
    notes.forEach(note => {
      const noteStart = note.start_time
      const noteEnd = note.start_time + note.duration
      
      if (noteStart < binEnd && noteEnd > binStart) {
        const pc = noteToPitchClass(note.pitch)
        const overlap = Math.min(noteEnd, binEnd) - Math.max(noteStart, binStart)
        binVector[pc] += (overlap * note.velocity) / 127.0
      }
    })
    
    const maxVal = Math.max(...binVector, 1e-8)
    matrix.push(binVector.map(v => v / maxVal))
  }
  
  return matrix
}

export function detectChordFromNotes(notes) {
  if (!notes || notes.length === 0) return null
  
  const pitchCounts = {}
  notes.forEach(note => {
    const pc = noteToPitchClass(note.pitch)
    pitchCounts[pc] = (pitchCounts[pc] || 0) + note.duration
  })
  
  const sortedPitches = Object.entries(pitchCounts)
    .sort((a, b) => b[1] - a[1])
    .map(x => parseInt(x[0]))
  
  if (sortedPitches.length === 0) return null
  
  const root = sortedPitches[0]
  const presentPitches = new Set(sortedPitches)
  
  let bestMatch = null
  let bestScore = 0
  
  Object.entries(CHORD_TYPES).forEach(([type, info]) => {
    const chordPitches = info.intervals.map(i => (root + i) % 12)
    let matchCount = 0
    chordPitches.forEach(p => {
      if (presentPitches.has(p)) matchCount++
    })
    
    const score = matchCount / chordPitches.length
    if (score > bestScore) {
      bestScore = score
      bestMatch = {
        root: NOTE_NAMES[root],
        type,
        label: `${NOTE_NAMES[root]}${info.symbol}`,
        confidence: score
      }
    }
  })
  
  return bestMatch
}

export function getChordNotes(rootNote, chordType) {
  const rootIndex = NOTE_NAMES.indexOf(rootNote)
  if (rootIndex === -1) return []
  
  const typeInfo = CHORD_TYPES[chordType]
  if (!typeInfo) return []
  
  return typeInfo.intervals.map(interval => rootIndex + interval)
}
