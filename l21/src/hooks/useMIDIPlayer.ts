import { useEffect, useRef, useCallback, useState } from 'react';
import * as Tone from 'tone';
import type { Position } from '../../shared/types';
import { DEFAULT_ABC_SCORE } from '../utils/abcUtils';

export interface NoteEvent {
  note: string;
  duration: number;
  time: number;
  velocity: number;
  midiNumber: number;
  startLine?: number;
  startCh?: number;
  endLine?: number;
  endCh?: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  isReady: boolean;
  currentNoteIndex: number;
  progress: number;
  duration: number;
  currentTime: number;
  playbackSpeed: number;
  error: string | null;
}

interface UseMIDIPlayerOptions {
  abcContent?: string;
  onNoteStart?: (note: NoteEvent, index: number) => void;
  onNoteEnd?: (note: NoteEvent, index: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onSeek?: (noteIndex: number) => void;
  onComplete?: () => void;
  onSpeedChange?: (speed: number) => void;
  onError?: (error: Error) => void;
}

interface UseMIDIPlayerReturn {
  playbackState: PlaybackState;
  notes: NoteEvent[];
  play: (startNoteIndex?: number) => Promise<void>;
  pause: () => void;
  stop: () => void;
  seek: (noteIndex: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  loadABC: (abcContent: string) => Promise<void>;
  reload: () => Promise<void>;
  getNoteAtPosition: (position: Position) => number | null;
  getPositionForNote: (noteIndex: number) => Position | null;
}

const NOTE_REGEX = /([A-Ga-g][#,b]?)(['`,]*)(\d*\/?\d*)/g;
const NOTE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NOTE_VALUES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteToMidi(note: string, octave: number, accidental: string): number {
  const noteName = note.toUpperCase();
  const baseValue = NOTE_VALUES[noteName] ?? 0;
  const octaveOffset = (octave + 1) * 12;
  let accidentalOffset = 0;

  if (accidental === '#') {
    accidentalOffset = 1;
  } else if (accidental === 'b') {
    accidentalOffset = -1;
  }

  return octaveOffset + baseValue + accidentalOffset;
}

function parseABCToNotes(abcContent: string): { notes: NoteEvent[]; tempo: number; baseNoteDuration: number } {
  const lines = abcContent.split('\n');
  let tempo = 120;
  let baseNoteDuration = 1 / 8;
  let keySignature = 'C';
  let octave = 4;
  let currentTime = 0;
  const notes: NoteEvent[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('Q:')) {
      const tempoMatch = trimmedLine.match(/Q:(\d+\/?\d*)=(\d+)/);
      if (tempoMatch) {
        tempo = parseInt(tempoMatch[2], 10);
      }
      continue;
    }

    if (trimmedLine.startsWith('L:')) {
      const durationMatch = trimmedLine.match(/L:(\d+)\/(\d+)/);
      if (durationMatch) {
        baseNoteDuration = parseInt(durationMatch[1], 10) / parseInt(durationMatch[2], 10);
      }
      continue;
    }

    if (trimmedLine.startsWith('K:')) {
      keySignature = trimmedLine.substring(2).trim();
      continue;
    }

    if (trimmedLine.startsWith('%') || trimmedLine === '' || trimmedLine.match(/^[TMC]:/)) {
      continue;
    }

    let match: RegExpExecArray | null;
    NOTE_REGEX.lastIndex = 0;

    while ((match = NOTE_REGEX.exec(line)) !== null) {
      const [fullMatch, noteName, octaveMarkers, durationStr] = match;
      const startCh = match.index;
      const endCh = startCh + fullMatch.length;

      let accidental = '';
      let actualNoteName = noteName;

      if (noteName.length > 1) {
        accidental = noteName[1];
        actualNoteName = noteName[0];
      }

      let noteOctave = octave;
      for (const marker of octaveMarkers) {
        if (marker === "'") {
          noteOctave++;
        } else if (marker === ',') {
          noteOctave--;
        }
      }

      let duration = baseNoteDuration;
      if (durationStr) {
        if (durationStr.includes('/')) {
          const [num, den] = durationStr.split('/');
          duration = (parseInt(num, 10) || 1) / (parseInt(den, 10) || 1);
        } else {
          duration = baseNoteDuration * parseInt(durationStr, 10);
        }
      }

      const midiNumber = noteToMidi(actualNoteName, noteOctave, accidental);
      const noteEvent: NoteEvent = {
        note: `${actualNoteName}${accidental}${noteOctave}`,
        duration: duration * (60 / tempo) * 4,
        time: currentTime,
        velocity: 0.8,
        midiNumber,
        startLine: lineIdx,
        startCh,
        endLine: lineIdx,
        endCh,
      };

      notes.push(noteEvent);
      currentTime += noteEvent.duration;
    }
  }

  return { notes, tempo, baseNoteDuration };
}

export function useMIDIPlayer({
  abcContent = DEFAULT_ABC_SCORE,
  onNoteStart,
  onNoteEnd,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onComplete,
  onSpeedChange,
  onError,
}: UseMIDIPlayerOptions = {}): UseMIDIPlayerReturn {
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const scheduleIdsRef = useRef<number[]>([]);
  const notesRef = useRef<NoteEvent[]>([]);
  const currentNoteIndexRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    isPaused: false,
    isReady: false,
    currentNoteIndex: 0,
    progress: 0,
    duration: 0,
    currentTime: 0,
    playbackSpeed: 1,
    error: null,
  });

  const clearScheduledEvents = useCallback(() => {
    scheduleIdsRef.current.forEach((id) => {
      Tone.Transport.clear(id);
    });
    scheduleIdsRef.current = [];
  }, []);

  const loadABC = useCallback(
    async (content: string) => {
      try {
        setPlaybackState((prev) => ({ ...prev, isReady: false, error: null }));

        await Tone.start();

        if (!synthRef.current) {
          synthRef.current = new Tone.PolySynth(Tone.Synth, {
            oscillator: {
              type: 'sine',
            },
            envelope: {
              attack: 0.02,
              decay: 0.1,
              sustain: 0.3,
              release: 0.8,
            },
          }).toDestination();
        }

        const { notes: parsedNotes } = parseABCToNotes(content);
        notesRef.current = parsedNotes;
        setNotes(parsedNotes);

        const totalDuration = parsedNotes.length > 0 ? parsedNotes[parsedNotes.length - 1].time + parsedNotes[parsedNotes.length - 1].duration : 0;

        setPlaybackState((prev) => ({
          ...prev,
          isReady: true,
          duration: totalDuration,
          currentNoteIndex: 0,
          progress: 0,
          currentTime: 0,
        }));
      } catch (error) {
        console.error('Failed to load ABC:', error);
        const err = error instanceof Error ? error : new Error('Failed to load ABC');
        setPlaybackState((prev) => ({ ...prev, error: err.message }));
        onError?.(err);
      }
    },
    [onError]
  );

  const reload = useCallback(async () => {
    await loadABC(abcContent);
  }, [abcContent, loadABC]);

  const scheduleNotes = useCallback(
    (startNoteIndex: number = 0) => {
      if (!synthRef.current) return;

      clearScheduledEvents();

      const speed = playbackState.playbackSpeed;
      const startNote = notesRef.current[startNoteIndex];
      if (!startNote) return;

      const offsetTime = startNote.time / speed;
      startTimeRef.current = Tone.Transport.seconds - offsetTime;

      for (let i = startNoteIndex; i < notesRef.current.length; i++) {
        const note = notesRef.current[i];
        const adjustedTime = note.time / speed;
        const adjustedDuration = note.duration / speed;

        const startId = Tone.Transport.schedule((time) => {
          synthRef.current?.triggerAttackRelease(note.note, adjustedDuration, time, note.velocity);
          currentNoteIndexRef.current = i;

          setPlaybackState((prev) => {
            const elapsed = time - startTimeRef.current;
            const totalDuration = prev.duration / speed;
            return {
              ...prev,
              currentNoteIndex: i,
              currentTime: elapsed * speed,
              progress: totalDuration > 0 ? (elapsed * speed) / prev.duration : 0,
            };
          });

          onNoteStart?.(note, i);
        }, adjustedTime);

        scheduleIdsRef.current.push(startId);

        const endId = Tone.Transport.schedule(() => {
          onNoteEnd?.(note, i);
        }, adjustedTime + adjustedDuration);

        scheduleIdsRef.current.push(endId);
      }

      const lastNote = notesRef.current[notesRef.current.length - 1];
      if (lastNote) {
        const endTime = (lastNote.time + lastNote.duration) / speed;
        const completeId = Tone.Transport.schedule(() => {
          setPlaybackState((prev) => ({
            ...prev,
            isPlaying: false,
            isPaused: false,
            currentNoteIndex: 0,
            progress: 1,
            currentTime: prev.duration,
          }));
          Tone.Transport.stop();
          clearScheduledEvents();
          onComplete?.();
        }, endTime);
        scheduleIdsRef.current.push(completeId);
      }
    },
    [playbackState.playbackSpeed, clearScheduledEvents, onNoteStart, onNoteEnd, onComplete]
  );

  const play = useCallback(
    async (startNoteIndex?: number) => {
      try {
        await Tone.start();

        if (!synthRef.current || notesRef.current.length === 0) {
          throw new Error('MIDI player not ready');
        }

        const startIdx = startNoteIndex ?? currentNoteIndexRef.current;

        if (Tone.Transport.state === 'paused') {
          Tone.Transport.start();
        } else {
          Tone.Transport.stop();
          clearScheduledEvents();
          scheduleNotes(startIdx);
          Tone.Transport.start();
        }

        currentNoteIndexRef.current = startIdx;
        setPlaybackState((prev) => ({
          ...prev,
          isPlaying: true,
          isPaused: false,
          currentNoteIndex: startIdx,
        }));

        onPlay?.();
      } catch (error) {
        console.error('Failed to play:', error);
        const err = error instanceof Error ? error : new Error('Failed to play');
        setPlaybackState((prev) => ({ ...prev, error: err.message }));
        onError?.(err);
      }
    },
    [clearScheduledEvents, scheduleNotes, onPlay, onError]
  );

  const pause = useCallback(() => {
    if (Tone.Transport.state === 'started') {
      Tone.Transport.pause();
      pauseTimeRef.current = Tone.Transport.seconds;
      setPlaybackState((prev) => ({
        ...prev,
        isPlaying: false,
        isPaused: true,
      }));
      onPause?.();
    }
  }, [onPause]);

  const stop = useCallback(() => {
    Tone.Transport.stop();
    clearScheduledEvents();
    currentNoteIndexRef.current = 0;
    startTimeRef.current = 0;
    pauseTimeRef.current = 0;
    setPlaybackState((prev) => ({
      ...prev,
      isPlaying: false,
      isPaused: false,
      currentNoteIndex: 0,
      progress: 0,
      currentTime: 0,
    }));
    onStop?.();
  }, [clearScheduledEvents, onStop]);

  const seek = useCallback(
    (noteIndex: number) => {
      if (noteIndex < 0 || noteIndex >= notesRef.current.length) return;

      const wasPlaying = playbackState.isPlaying;
      Tone.Transport.stop();
      clearScheduledEvents();
      currentNoteIndexRef.current = noteIndex;

      const note = notesRef.current[noteIndex];
      if (note) {
        setPlaybackState((prev) => ({
          ...prev,
          currentNoteIndex: noteIndex,
          currentTime: note.time,
          progress: prev.duration > 0 ? note.time / prev.duration : 0,
        }));
      }

      if (wasPlaying) {
        scheduleNotes(noteIndex);
        Tone.Transport.start();
      }

      onSeek?.(noteIndex);
    },
    [playbackState.isPlaying, clearScheduledEvents, scheduleNotes, onSeek]
  );

  const setPlaybackSpeed = useCallback(
    (speed: number) => {
      const clampedSpeed = Math.max(0.25, Math.min(4, speed));
      const wasPlaying = playbackState.isPlaying;
      const currentIndex = currentNoteIndexRef.current;

      if (wasPlaying) {
        Tone.Transport.stop();
        clearScheduledEvents();
      }

      setPlaybackState((prev) => ({
        ...prev,
        playbackSpeed: clampedSpeed,
      }));

      if (wasPlaying) {
        scheduleNotes(currentIndex);
        Tone.Transport.start();
      }

      onSpeedChange?.(clampedSpeed);
    },
    [playbackState.isPlaying, clearScheduledEvents, scheduleNotes, onSpeedChange]
  );

  const getNoteAtPosition = useCallback((position: Position): number | null => {
    for (let i = 0; i < notesRef.current.length; i++) {
      const note = notesRef.current[i];
      if (
        note.startLine !== undefined &&
        note.endLine !== undefined &&
        note.startCh !== undefined &&
        note.endCh !== undefined
      ) {
        if (
          position.line >= note.startLine &&
          position.line <= note.endLine &&
          position.ch >= note.startCh &&
          position.ch < note.endCh
        ) {
          return i;
        }
      }
    }
    return null;
  }, []);

  const getPositionForNote = useCallback((noteIndex: number): Position | null => {
    const note = notesRef.current[noteIndex];
    if (note && note.startLine !== undefined && note.startCh !== undefined) {
      return { line: note.startLine, ch: note.startCh };
    }
    return null;
  }, []);

  useEffect(() => {
    loadABC(abcContent);

    return () => {
      stop();
      if (synthRef.current) {
        synthRef.current.dispose();
        synthRef.current = null;
      }
    };
  }, [abcContent, loadABC, stop]);

  return {
    playbackState,
    notes,
    play,
    pause,
    stop,
    seek,
    setPlaybackSpeed,
    loadABC,
    reload,
    getNoteAtPosition,
    getPositionForNote,
  };
}
