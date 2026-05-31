import mido
import numpy as np
from typing import List, Dict, Any, Tuple
from dataclasses import dataclass, asdict
import uuid


@dataclass
class Note:
    id: str
    pitch: int
    velocity: int
    start_time: float
    duration: float
    track: int
    channel: int
    note_name: str


@dataclass
class Track:
    id: int
    name: str
    program: int
    channel: int
    notes_count: int


@dataclass
class TimeSignature:
    numerator: int
    denominator: int
    time: float


@dataclass
class Tempo:
    bpm: float
    time: float


@dataclass
class MidiData:
    midi_id: str
    filename: str
    ticks_per_beat: int
    time_signatures: List[TimeSignature]
    tempos: List[Tempo]
    tracks: List[Track]
    notes: List[Note]
    total_duration: float
    total_notes: int


NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def note_number_to_name(note_number: int) -> str:
    octave = note_number // 12 - 1
    note_index = note_number % 12
    return f"{NOTE_NAMES[note_index]}{octave}"


def parse_midi_file(file_path: str, filename: str) -> MidiData:
    mid = mido.MidiFile(file_path)
    ticks_per_beat = mid.ticks_per_beat

    time_signatures: List[TimeSignature] = []
    tempos: List[Tempo] = []
    tracks: List[Track] = []
    notes: List[Note] = []

    track_note_counts = {}
    track_names = {}
    track_programs = {}
    track_channels = {}

    for track_idx, track in enumerate(mid.tracks):
        current_time = 0.0
        note_on_events = {}
        track_name = f"Track {track_idx}"
        program = 0
        channel = 0

        for msg in track:
            delta_seconds = mido.tick2second(msg.time, ticks_per_beat, 500000)
            current_time += delta_seconds

            if msg.type == 'track_name':
                track_name = msg.name
            elif msg.type == 'program_change':
                program = msg.program
                channel = msg.channel
                track_programs[track_idx] = program
                track_channels[track_idx] = channel
            elif msg.type == 'time_signature':
                time_signatures.append(TimeSignature(
                    numerator=msg.numerator,
                    denominator=msg.denominator,
                    time=current_time
                ))
            elif msg.type == 'set_tempo':
                bpm = mido.tempo2bpm(msg.tempo)
                tempos.append(Tempo(bpm=bpm, time=current_time))
            elif msg.type == 'note_on' and msg.velocity > 0:
                key = (msg.note, msg.channel)
                note_on_events[key] = {
                    'start_time': current_time,
                    'velocity': msg.velocity,
                    'pitch': msg.note
                }
            elif (msg.type == 'note_off' or 
                  (msg.type == 'note_on' and msg.velocity == 0)):
                key = (msg.note, msg.channel)
                if key in note_on_events:
                    note_info = note_on_events.pop(key)
                    note = Note(
                        id=str(uuid.uuid4()),
                        pitch=note_info['pitch'],
                        velocity=note_info['velocity'],
                        start_time=note_info['start_time'],
                        duration=current_time - note_info['start_time'],
                        track=track_idx,
                        channel=msg.channel,
                        note_name=note_number_to_name(note_info['pitch'])
                    )
                    notes.append(note)
                    track_note_counts[track_idx] = track_note_counts.get(track_idx, 0) + 1

        track_names[track_idx] = track_name

    for track_idx in range(len(mid.tracks)):
        tracks.append(Track(
            id=track_idx,
            name=track_names.get(track_idx, f"Track {track_idx}"),
            program=track_programs.get(track_idx, 0),
            channel=track_channels.get(track_idx, 0),
            notes_count=track_note_counts.get(track_idx, 0)
        ))

    total_duration = max(note.start_time + note.duration for note in notes) if notes else 0.0

    return MidiData(
        midi_id=str(uuid.uuid4()),
        filename=filename,
        ticks_per_beat=ticks_per_beat,
        time_signatures=time_signatures,
        tempos=tempos,
        tracks=tracks,
        notes=notes,
        total_duration=total_duration,
        total_notes=len(notes)
    )


def midi_to_dict(midi_data: MidiData) -> Dict[str, Any]:
    return {
        'midi_id': midi_data.midi_id,
        'filename': midi_data.filename,
        'ticks_per_beat': midi_data.ticks_per_beat,
        'time_signatures': [asdict(ts) for ts in midi_data.time_signatures],
        'tempos': [asdict(t) for t in midi_data.tempos],
        'tracks': [asdict(t) for t in midi_data.tracks],
        'notes': [asdict(n) for n in midi_data.notes],
        'total_duration': midi_data.total_duration,
        'total_notes': midi_data.total_notes
    }
