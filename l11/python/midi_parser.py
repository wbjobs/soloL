import mido
import numpy as np
import json
import sys
import gc
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, asdict
from collections import defaultdict
from weakref import WeakSet

MIDI_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
_active_objects = WeakSet()
MAX_NOTES_IN_MEMORY = 50000

GENERAL_MIDI_INSTRUMENTS = [
    "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
    "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
    "Celesta", "Glockenspiel", "Music Box", "Vibraphone",
    "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
    "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ",
    "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
    "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)",
    "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar harmonics",
    "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass",
    "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
    "Violin", "Viola", "Cello", "Contrabass",
    "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
    "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2",
    "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
    "Trumpet", "Trombone", "Tuba", "Muted Trumpet",
    "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
    "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax",
    "Oboe", "English Horn", "Bassoon", "Clarinet",
    "Piccolo", "Flute", "Recorder", "Pan Flute",
    "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
    "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)",
    "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
    "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)",
    "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
    "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)",
    "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
    "Sitar", "Banjo", "Shamisen", "Koto",
    "Kalimba", "Bagpipe", "Fiddle", "Shanai",
    "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock",
    "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
    "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet",
    "Telephone Ring", "Helicopter", "Applause", "Gunshot"
]

CHORD_TYPES = {
    (0, 4, 7): 'major',
    (0, 3, 7): 'minor',
    (0, 4, 7, 10): 'dominant7',
    (0, 4, 7, 11): 'major7',
    (0, 3, 7, 10): 'minor7',
    (0, 3, 6): 'dim',
    (0, 4, 8): 'aug',
    (0, 5, 7): 'sus4',
    (0, 2, 7): 'sus2',
    (0, 3, 6, 9): 'dim7',
    (0, 3, 7, 11): 'min_maj7',
    (0, 4, 7, 10, 14): 'dominant9',
}

@dataclass
class Note:
    pitch: int
    velocity: int
    start_time: float
    duration: float
    track: int
    channel: int

@dataclass
class Chord:
    name: str
    start_time: float
    duration: float
    notes: List[int]

@dataclass
class Instrument:
    program: int
    name: str
    track_number: int
    note_count: int
    is_percussion: bool

@dataclass
class MidiAnalysis:
    duration_seconds: float
    tempo_bpm: int
    time_signature: str
    key_signature: str
    note_count: int
    track_count: int
    notes: List[Note]
    chords: List[Chord]
    instruments: List[Instrument]
    sections: List[Dict]
    tempo_changes: List[Tuple[float, int]]
    pitch_histogram: List[int]
    velocity_stats: Dict


def note_number_to_name(note_number: int) -> str:
    octave = note_number // 12 - 1
    note_name = MIDI_NOTE_NAMES[note_number % 12]
    return f"{note_name}{octave}"


def identify_chord(pitches: List[int]) -> Optional[str]:
    if len(pitches) < 3:
        return None
    
    root = min(pitches)
    intervals = tuple(sorted(set((p - root) % 12 for p in pitches)))
    
    for chord_intervals, chord_type in CHORD_TYPES.items():
        if all(interval in intervals for interval in chord_intervals):
            root_name = MIDI_NOTE_NAMES[root % 12]
            return f"{root_name} {chord_type}"
    
    root_name = MIDI_NOTE_NAMES[root % 12]
    return f"{root_name} complex"


def parse_midi(file_path: str, max_notes: int = MAX_NOTES_IN_MEMORY) -> MidiAnalysis:
    mid = mido.MidiFile(file_path)
    _active_objects.add(mid)
    
    try:
        ticks_per_beat = mid.ticks_per_beat
        tempo = 500000
        tempo_changes = []
        
        notes = []
        active_notes = defaultdict(list)
        
        instruments = {}
        instrument_note_counts = defaultdict(int)
        
        time_signature = "4/4"
        key_signature = "C major"
        
        note_count = 0
        messages_processed = 0
        
        for track_num, track in enumerate(mid.tracks):
            track_time_ticks = 0
            for msg in track:
                track_time_ticks += msg.time
                seconds = mido.tick2second(track_time_ticks, ticks_per_beat, tempo)
                
                if msg.type == 'set_tempo':
                    tempo = msg.tempo
                    bpm = mido.tempo2bpm(tempo)
                    tempo_changes.append((seconds, int(bpm)))
                
                elif msg.type == 'time_signature':
                    time_signature = f"{msg.numerator}/{msg.denominator}"
                
                elif msg.type == 'key_signature':
                    key_signature = msg.key
                
                elif msg.type == 'program_change':
                    is_percussion = msg.channel == 9
                    program = msg.program
                    if is_percussion:
                        inst_name = "Drums"
                    else:
                        inst_name = GENERAL_MIDI_INSTRUMENTS[program] if program < len(GENERAL_MIDI_INSTRUMENTS) else f"Program {program}"
                    
                    key = (track_num, msg.channel)
                    instruments[key] = Instrument(
                        program=program,
                        name=inst_name,
                        track_number=track_num,
                        note_count=0,
                        is_percussion=is_percussion
                    )
                
                elif msg.type == 'note_on' and msg.velocity > 0:
                    key = (track_num, msg.channel, msg.note)
                    active_notes[key].append((seconds, msg.velocity))
                
                elif (msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0)):
                    key = (track_num, msg.channel, msg.note)
                    if key in active_notes and active_notes[key]:
                        start_time, velocity = active_notes[key].pop(0)
                        duration = seconds - start_time
                        
                        note_count += 1
                        if note_count <= max_notes:
                            notes.append(Note(
                                pitch=msg.note,
                                velocity=velocity,
                                start_time=start_time,
                                duration=duration,
                                track=track_num,
                                channel=msg.channel
                            ))
                        
                        inst_key = (track_num, msg.channel)
                        instrument_note_counts[inst_key] += 1
                
                messages_processed += 1
                if messages_processed % 10000 == 0:
                    gc.collect()
        
        for key, count in instrument_note_counts.items():
            if key in instruments:
                instruments[key].note_count = count
            else:
                is_percussion = key[1] == 9
                program = 0 if is_percussion else 0
                inst_name = "Drums" if is_percussion else GENERAL_MIDI_INSTRUMENTS[0]
                instruments[key] = Instrument(
                    program=program,
                    name=inst_name,
                    track_number=key[0],
                    note_count=count,
                    is_percussion=is_percussion
                )
        
        duration_seconds = mid.length
        avg_bpm = int(np.mean([t[1] for t in tempo_changes])) if tempo_changes else 120
        
        notes.sort(key=lambda n: n.start_time)
        
        chords = extract_chords(notes)
        sections = extract_sections(notes, duration_seconds)
        
        pitch_histogram = [0] * 128
        for note in notes:
            pitch_histogram[note.pitch] += 1
        
        velocities = [n.velocity for n in notes]
        velocity_stats = {
            'mean': float(np.mean(velocities)) if velocities else 0,
            'std': float(np.std(velocities)) if velocities else 0,
            'max': max(velocities) if velocities else 0,
            'min': min(velocities) if velocities else 0
        }
        
        analysis = MidiAnalysis(
            duration_seconds=float(duration_seconds),
            tempo_bpm=avg_bpm,
            time_signature=time_signature,
            key_signature=key_signature,
            note_count=note_count,
            track_count=len(mid.tracks),
            notes=notes,
            chords=chords,
            instruments=list(instruments.values()),
            sections=sections,
            tempo_changes=tempo_changes,
            pitch_histogram=pitch_histogram,
            velocity_stats=velocity_stats
        )
        
        _active_objects.add(analysis)
        return analysis
        
    finally:
        mid.close() if hasattr(mid, 'close') else None
        del active_notes
        del instrument_note_counts
        gc.collect()


def extract_chords(notes: List[Note], time_window: float = 0.1) -> List[Chord]:
    if not notes:
        return []
    
    chords = []
    notes_by_time = defaultdict(list)
    
    for note in notes:
        bucket = round(note.start_time / time_window) * time_window
        notes_by_time[bucket].append(note)
    
    for time, time_notes in sorted(notes_by_time.items()):
        if len(time_notes) >= 3:
            pitches = [n.pitch for n in time_notes]
            chord_name = identify_chord(pitches)
            if chord_name:
                max_duration = max(n.duration for n in time_notes)
                chords.append(Chord(
                    name=chord_name,
                    start_time=float(time),
                    duration=float(max_duration),
                    notes=pitches
                ))
    
    merged_chords = []
    for chord in chords:
        if merged_chords and abs(chord.start_time - merged_chords[-1].start_time - merged_chords[-1].duration) < 0.3:
            if chord.name == merged_chords[-1].name:
                merged_chords[-1].duration = float(chord.start_time + chord.duration - merged_chords[-1].start_time)
                continue
        merged_chords.append(chord)
    
    return merged_chords[:50]


def extract_sections(notes: List[Note], duration: float) -> List[Dict]:
    if not notes:
        return []
    
    sections = []
    section_duration = max(8.0, duration / 8.0)
    
    labels = ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Bridge', 'Chorus', 'Outro']
    
    current_time = 0.0
    section_idx = 0
    
    while current_time < duration and section_idx < len(labels):
        end_time = min(current_time + section_duration, duration)
        sections.append({
            'label': labels[section_idx],
            'start_time': float(current_time),
            'end_time': float(end_time),
            'description': f'{labels[section_idx]} section'
        })
        current_time = end_time
        section_idx += 1
    
    return sections


def analysis_to_dict(analysis: MidiAnalysis) -> Dict:
    return {
        'metadata': {
            'duration_seconds': analysis.duration_seconds,
            'tempo_bpm': analysis.tempo_bpm,
            'time_signature': analysis.time_signature,
            'key_signature': analysis.key_signature,
            'note_count': analysis.note_count,
            'track_count': analysis.track_count,
            'tempo_changes': analysis.tempo_changes,
            'velocity_stats': analysis.velocity_stats,
            'pitch_histogram': analysis.pitch_histogram
        },
        'notes': [asdict(n) for n in analysis.notes[:1000]],
        'chords': [asdict(c) for c in analysis.chords],
        'instruments': [asdict(i) for i in analysis.instruments],
        'sections': analysis.sections,
        'note_density': compute_note_density(analysis.notes, analysis.duration_seconds)
    }


def compute_note_density(notes: List[Note], duration: float) -> List[float]:
    if duration <= 0 or not notes:
        return []
    
    num_bins = min(100, max(10, int(duration)))
    bin_size = duration / num_bins
    density = [0] * num_bins
    
    for note in notes:
        bin_idx = min(int(note.start_time / bin_size), num_bins - 1)
        density[bin_idx] += 1
    
    max_density = max(density) if density else 1
    return [d / max_density for d in density]


if __name__ == '__main__':
    try:
        file_path = sys.argv[1]
        analysis = parse_midi(file_path)
        result = analysis_to_dict(analysis)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)
