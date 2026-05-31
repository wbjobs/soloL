import * as ort from 'onnxruntime-web';

ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
ort.env.logLevel = 'warning';

export interface NoteInfo {
  pitch: string;
  octave: number;
  midiNumber: number;
  duration: number;
  beatPosition: number;
}

export interface ChordRecommendation {
  chord: string;
  root: string;
  quality: string;
  probability: number;
  harmonicFit: number;
  voiceLeading: string[];
}

export interface ChordProgression {
  measures: ChordRecommendation[][];
  key: string;
  style: 'classical' | 'pop' | 'jazz' | 'blues';
}

const NOTE_TO_MIDI: Record<string, number> = {
  'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
  'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11,
};

const CHORD_QUALITIES = {
  major: { intervals: [0, 4, 7], symbol: '' },
  minor: { intervals: [0, 3, 7], symbol: 'm' },
  seventh: { intervals: [0, 4, 7, 10], symbol: '7' },
  minorSeventh: { intervals: [0, 3, 7, 10], symbol: 'm7' },
  majorSeventh: { intervals: [0, 4, 7, 11], symbol: 'maj7' },
  diminished: { intervals: [0, 3, 6], symbol: 'dim' },
  augmented: { intervals: [0, 4, 8], symbol: 'aug' },
  sus2: { intervals: [0, 2, 7], symbol: 'sus2' },
  sus4: { intervals: [0, 5, 7], symbol: 'sus4' },
};

const KEY_PROGRESSIONS: Record<string, Record<string, string[][]>> = {
  'C': {
    classical: [['C', 'F', 'G', 'C'], ['C', 'Am', 'F', 'G'], ['C', 'G', 'Am', 'F']],
    pop: [['C', 'G', 'Am', 'F'], ['F', 'C', 'G', 'Am'], ['C', 'Am', 'F', 'G']],
    jazz: [['Cmaj7', 'Dm7', 'G7', 'Cmaj7'], ['Am7', 'Dm7', 'G7', 'Cmaj7']],
    blues: [['C7', 'F7', 'C7', 'C7'], ['F7', 'F7', 'C7', 'C7'], ['G7', 'F7', 'C7', 'G7']],
  },
  'G': {
    classical: [['G', 'C', 'D', 'G'], ['G', 'Em', 'C', 'D'], ['G', 'D', 'Em', 'C']],
    pop: [['G', 'D', 'Em', 'C'], ['C', 'G', 'D', 'Em'], ['G', 'Em', 'C', 'D']],
    jazz: [['Gmaj7', 'Am7', 'D7', 'Gmaj7'], ['Em7', 'Am7', 'D7', 'Gmaj7']],
    blues: [['G7', 'C7', 'G7', 'G7'], ['C7', 'C7', 'G7', 'G7'], ['D7', 'C7', 'G7', 'D7']],
  },
  'D': {
    classical: [['D', 'G', 'A', 'D'], ['D', 'Bm', 'G', 'A'], ['D', 'A', 'Bm', 'G']],
    pop: [['D', 'A', 'Bm', 'G'], ['G', 'D', 'A', 'Bm'], ['D', 'Bm', 'G', 'A']],
    jazz: [['Dmaj7', 'Em7', 'A7', 'Dmaj7'], ['Bm7', 'Em7', 'A7', 'Dmaj7']],
    blues: [['D7', 'G7', 'D7', 'D7'], ['G7', 'G7', 'D7', 'D7'], ['A7', 'G7', 'D7', 'A7']],
  },
  'F': {
    classical: [['F', 'Bb', 'C', 'F'], ['F', 'Dm', 'Bb', 'C'], ['F', 'C', 'Dm', 'Bb']],
    pop: [['F', 'C', 'Dm', 'Bb'], ['Bb', 'F', 'C', 'Dm'], ['F', 'Dm', 'Bb', 'C']],
    jazz: [['Fmaj7', 'Gm7', 'C7', 'Fmaj7'], ['Dm7', 'Gm7', 'C7', 'Fmaj7']],
    blues: [['F7', 'Bb7', 'F7', 'F7'], ['Bb7', 'Bb7', 'F7', 'F7'], ['C7', 'Bb7', 'F7', 'C7']],
  },
  'Am': {
    classical: [['Am', 'Dm', 'Em', 'Am'], ['Am', 'F', 'C', 'G'], ['Am', 'Em', 'F', 'C']],
    pop: [['Am', 'F', 'C', 'G'], ['F', 'C', 'G', 'Am'], ['Am', 'Em', 'F', 'C']],
    jazz: [['Am7', 'Dm7', 'G7', 'Am7'], ['Em7', 'Dm7', 'G7', 'Am7']],
    blues: [['Am7', 'Dm7', 'G7', 'Am7'], ['Dm7', 'Dm7', 'Am7', 'Am7'], ['E7', 'Dm7', 'Am7', 'E7']],
  },
};

export function parseABCNotes(abcContent: string, startLine: number, endLine: number): NoteInfo[] {
  const lines = abcContent.split('\n');
  const notes: NoteInfo[] = [];
  let beatPosition = 0;

  for (let i = startLine; i <= endLine && i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('%') || line.match(/^[A-Z]:/) || line === '') continue;

    let j = 0;
    while (j < line.length) {
      const char = line[j];

      if (char.match(/[A-Ga-g]/)) {
        const noteName = char.toUpperCase();
        const baseMidi = NOTE_TO_MIDI[noteName];

        let octave = 4;
        if (char === char.toLowerCase()) {
          octave = 5;
        }

        let k = j + 1;
        while (k < line.length && line[k] === "'") {
          octave++;
          k++;
        }
        while (k < line.length && line[k] === ',') {
          octave--;
          k++;
        }

        let duration = 1;
        while (k < line.length && line[k].match(/[0-9]/)) {
          duration = parseInt(line[k]);
          k++;
        }

        if (k < line.length && line[k] === '/') {
          k++;
          if (k < line.length && line[k].match(/[0-9]/)) {
            duration = duration / parseInt(line[k]);
            k++;
          } else {
            duration = duration / 2;
          }
        }

        const midiNumber = octave * 12 + baseMidi;

        notes.push({
          pitch: noteName,
          octave,
          midiNumber,
          duration,
          beatPosition,
        });

        beatPosition += duration;
        j = k;
      } else if (char === '|' || char === ' ') {
        j++;
      } else if (char === 'z' || char === 'x') {
        let duration = 1;
        let k = j + 1;
        while (k < line.length && line[k].match(/[0-9]/)) {
          duration = parseInt(line[k]);
          k++;
        }
        beatPosition += duration;
        j = k;
      } else {
        j++;
      }
    }
  }

  return notes;
}

export function detectKey(notes: NoteInfo[]): string {
  if (notes.length === 0) return 'C';

  const pitchCounts: Record<number, number> = {};
  notes.forEach(note => {
    const pc = note.midiNumber % 12;
    pitchCounts[pc] = (pitchCounts[pc] || 0) + note.duration;
  });

  const keys = ['C', 'G', 'D', 'F', 'Am'];
  const keyProfiles: Record<string, number[]> = {
    'C': [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1],
    'G': [1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1],
    'D': [1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1],
    'F': [1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1],
    'Am': [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1],
  };

  let bestKey = 'C';
  let bestScore = -Infinity;

  keys.forEach(key => {
    let score = 0;
    for (let pc = 0; pc < 12; pc++) {
      if (pitchCounts[pc]) {
        score += pitchCounts[pc] * (keyProfiles[key][pc] || 0);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  });

  return bestKey;
}

function calculateHarmonicFit(notes: NoteInfo[], chordRoot: string, quality: keyof typeof CHORD_QUALITIES): number {
  if (notes.length === 0) return 0;

  const chordIntervals = CHORD_QUALITIES[quality].intervals;
  const rootMidi = NOTE_TO_MIDI[chordRoot] || 0;
  const chordPitches = new Set(chordIntervals.map(i => (rootMidi + i) % 12));

  let totalWeight = 0;
  let matchWeight = 0;

  notes.forEach(note => {
    const pitchClass = note.midiNumber % 12;
    const weight = note.duration;
    totalWeight += weight;
    if (chordPitches.has(pitchClass)) {
      matchWeight += weight;
    }
  });

  return totalWeight > 0 ? matchWeight / totalWeight : 0;
}

export async function recommendChords(
  abcContent: string,
  startLine: number,
  endLine: number,
  style: 'classical' | 'pop' | 'jazz' | 'blues' = 'pop'
): Promise<ChordRecommendation[]> {
  const notes = parseABCNotes(abcContent, startLine, endLine);
  const detectedKey = detectKey(notes);
  const keyData = KEY_PROGRESSIONS[detectedKey] || KEY_PROGRESSIONS['C'];
  const progressions = keyData[style] || keyData.pop;

  const recommendations: ChordRecommendation[] = [];
  const consideredChords = new Set<string>();

  progressions.forEach(progression => {
    progression.forEach(chordStr => {
      if (consideredChords.has(chordStr)) return;
      consideredChords.add(chordStr);

      let root = chordStr[0];
      let quality: keyof typeof CHORD_QUALITIES = 'major';

      if (chordStr.includes('maj7')) {
        quality = 'majorSeventh';
        root = chordStr.replace('maj7', '');
      } else if (chordStr.includes('m7')) {
        quality = 'minorSeventh';
        root = chordStr.replace('m7', '');
      } else if (chordStr.includes('7')) {
        quality = 'seventh';
        root = chordStr.replace('7', '');
      } else if (chordStr.includes('m')) {
        quality = 'minor';
        root = chordStr.replace('m', '');
      }

      const harmonicFit = calculateHarmonicFit(notes, root, quality);
      const progressionScore = 0.5 + Math.random() * 0.2;

      recommendations.push({
        chord: chordStr,
        root,
        quality,
        probability: harmonicFit * 0.6 + progressionScore * 0.4,
        harmonicFit,
        voiceLeading: CHORD_QUALITIES[quality].intervals.map(i => `${root}${i > 0 ? `+${i}` : ''}`),
      });
    });
  });

  const allRoots = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const qualities: (keyof typeof CHORD_QUALITIES)[] = ['major', 'minor', 'seventh', 'minorSeventh'];

  allRoots.forEach(root => {
    qualities.forEach(quality => {
      const chordStr = root + CHORD_QUALITIES[quality].symbol;
      if (consideredChords.has(chordStr)) return;

      const harmonicFit = calculateHarmonicFit(notes, root, quality);
      if (harmonicFit > 0.3) {
        recommendations.push({
          chord: chordStr,
          root,
          quality,
          probability: harmonicFit * 0.5,
          harmonicFit,
          voiceLeading: CHORD_QUALITIES[quality].intervals.map(i => `${root}${i > 0 ? `+${i}` : ''}`),
        });
      }
    });
  });

  return recommendations
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);
}

export async function generateChordProgression(
  abcContent: string,
  style: 'classical' | 'pop' | 'jazz' | 'blues' = 'pop'
): Promise<ChordProgression> {
  const lines = abcContent.split('\n');
  const measureBoundaries: { start: number; end: number }[] = [];
  let currentStart = 0;

  lines.forEach((line, index) => {
    if (line.includes('|') && !line.match(/^[A-Z]:/)) {
      measureBoundaries.push({ start: currentStart, end: index });
      currentStart = index + 1;
    }
  });

  if (currentStart < lines.length) {
    measureBoundaries.push({ start: currentStart, end: lines.length - 1 });
  }

  const detectedKey = detectKey(parseABCNotes(abcContent, 0, lines.length - 1));

  const measures: ChordRecommendation[][] = [];

  for (const boundary of measureBoundaries.slice(0, 8)) {
    const recs = await recommendChords(abcContent, boundary.start, boundary.end, style);
    measures.push(recs);
  }

  return {
    measures,
    key: detectedKey,
    style,
  };
}

export function insertChordToABC(
  abcContent: string,
  line: number,
  chord: string
): string {
  const lines = abcContent.split('\n');
  if (line >= lines.length) return abcContent;

  const targetLine = lines[line];
  const chordAnnotation = `"${chord}"`;

  if (targetLine.trim().startsWith('"')) {
    lines[line] = targetLine.replace(/"[^"]*"/, chordAnnotation);
  } else {
    lines[line] = chordAnnotation + ' ' + targetLine;
  }

  return lines.join('\n');
}

export async function recommendWithModel(
  abcContent: string,
  modelPath?: string
): Promise<ChordRecommendation[]> {
  try {
    if (!modelPath) {
      return recommendChords(abcContent, 0, abcContent.split('\n').length - 1);
    }

    const session = await ort.InferenceSession.create(modelPath);
    const notes = parseABCNotes(abcContent, 0, abcContent.split('\n').length - 1);

    const inputData = new Float32Array(128);
    notes.forEach(note => {
      if (note.midiNumber >= 0 && note.midiNumber < 128) {
        inputData[note.midiNumber] += note.duration;
      }
    });

    const inputTensor = new ort.Tensor('float32', inputData, [1, 128]);
    const outputs = await session.run({ input: inputTensor });
    const outputData = outputs.output?.data || [];

    const recommendations: ChordRecommendation[] = [];
    for (let i = 0; i < Math.min(3, outputData.length); i++) {
      recommendations.push({
        chord: ['C', 'F', 'G'][i] || 'C',
        root: ['C', 'F', 'G'][i] || 'C',
        quality: 'major',
        probability: outputData[i] || 0.33,
        harmonicFit: 0.7,
        voiceLeading: [],
      });
    }

    return recommendations;
  } catch (error) {
    console.warn('ONNX model not available, falling back to rule-based recommendation:', error);
    return recommendChords(abcContent, 0, abcContent.split('\n').length - 1);
  }
}
