import os
import asyncio
from typing import List, Dict, Any, Tuple
from dataclasses import dataclass, asdict
from dotenv import load_dotenv

from midi_parser import MidiData, Note
from redis_manager import redis_manager

load_dotenv()

TIME_SLICE_DURATION = float(os.getenv("TIME_SLICE_DURATION", "2.0"))


@dataclass
class TimeSlice:
    index: int
    start_time: float
    end_time: float
    notes: List[Dict[str, Any]]
    note_count: int


@dataclass
class SlicedMidiData:
    midi_id: str
    total_duration: float
    slice_duration: float
    total_slices: int
    slices: List[TimeSlice]
    track_summary: Dict[int, int]


def calculate_slice_count(total_duration: float, slice_duration: float = TIME_SLICE_DURATION) -> int:
    return int(total_duration // slice_duration) + (1 if total_duration % slice_duration > 0 else 0)


def create_time_slices(
    notes: List[Dict[str, Any]],
    total_duration: float,
    slice_duration: float = TIME_SLICE_DURATION
) -> Tuple[List[TimeSlice], Dict[int, int]]:
    total_slices = calculate_slice_count(total_duration, slice_duration)
    slices: List[TimeSlice] = []
    track_summary: Dict[int, int] = {}

    for i in range(total_slices):
        slice_start = i * slice_duration
        slice_end = min((i + 1) * slice_duration, total_duration)
        slice_notes = []

        for note in notes:
            note_start = note['start_time']
            note_end = note['start_time'] + note['duration']

            if note_start < slice_end and note_end > slice_start:
                adjusted_note = note.copy()
                adjusted_note['slice_start_time'] = max(0, note_start - slice_start)
                adjusted_note['global_start_time'] = note_start
                slice_notes.append(adjusted_note)

                track = note.get('track', 0)
                track_summary[track] = track_summary.get(track, 0) + 1

        slices.append(TimeSlice(
            index=i,
            start_time=slice_start,
            end_time=slice_end,
            notes=slice_notes,
            note_count=len(slice_notes)
        ))

    return slices, track_summary


async def preprocess_midi_to_slices(
    midi_data: MidiData,
    slice_duration: float = TIME_SLICE_DURATION,
    use_cache: bool = True
) -> SlicedMidiData:
    midi_id = midi_data.midi_id
    total_duration = midi_data.total_duration

    if use_cache and redis_manager.is_connected:
        cached_meta = await redis_manager.get_midi_slices_meta(midi_id)
        if cached_meta and cached_meta.get('slice_duration') == slice_duration:
            total_slices = cached_meta['total_slices']
            slices = []
            for i in range(total_slices):
                cached_slice = await redis_manager.get_midi_notes_slice(midi_id, i)
                if cached_slice:
                    slices.append(TimeSlice(
                        index=i,
                        start_time=i * slice_duration,
                        end_time=min((i + 1) * slice_duration, total_duration),
                        notes=cached_slice,
                        note_count=len(cached_slice)
                    ))
                else:
                    break
            
            if len(slices) == total_slices:
                print(f"Using cached slices for MIDI {midi_id}")
                return SlicedMidiData(
                    midi_id=midi_id,
                    total_duration=total_duration,
                    slice_duration=slice_duration,
                    total_slices=total_slices,
                    slices=slices,
                    track_summary=cached_meta.get('track_summary', {})
                )

    notes_dict = [asdict(note) for note in midi_data.notes]
    
    slices, track_summary = create_time_slices(notes_dict, total_duration, slice_duration)

    if use_cache and redis_manager.is_connected:
        await redis_manager.set_midi_slices_meta(midi_id, {
            'midi_id': midi_id,
            'total_duration': total_duration,
            'slice_duration': slice_duration,
            'total_slices': len(slices),
            'track_summary': track_summary
        })

        for slice_data in slices:
            await redis_manager.set_midi_notes_slice(
                midi_id,
                slice_data.index,
                slice_data.notes
            )
        print(f"Cached {len(slices)} slices for MIDI {midi_id}")

    return SlicedMidiData(
        midi_id=midi_id,
        total_duration=total_duration,
        slice_duration=slice_duration,
        total_slices=len(slices),
        slices=slices,
        track_summary=track_summary
    )


async def get_slices_by_time_range(
    midi_id: str,
    start_time: float,
    end_time: float,
    slice_duration: float = TIME_SLICE_DURATION
) -> List[Dict[str, Any]]:
    start_slice = int(start_time // slice_duration)
    end_slice = int(end_time // slice_duration)
    
    result = []
    
    if redis_manager.is_connected:
        for i in range(start_slice, end_slice + 1):
            cached = await redis_manager.get_midi_notes_slice(midi_id, i)
            if cached:
                result.extend(cached)
    
    return result


async def get_visible_slices(
    midi_id: str,
    viewport_start: float,
    viewport_end: float,
    slice_duration: float = TIME_SLICE_DURATION,
    preload_buffer: int = 2
) -> Dict[str, Any]:
    start_slice = max(0, int(viewport_start // slice_duration) - preload_buffer)
    end_slice = int(viewport_end // slice_duration) + preload_buffer

    meta = await redis_manager.get_midi_slices_meta(midi_id)
    if not meta:
        return {
            'visible_slices': [],
            'all_slices': [],
            'total_slices': 0,
            'slice_duration': slice_duration
        }

    total_slices = meta['total_slices']
    end_slice = min(end_slice, total_slices - 1)

    visible_notes = []
    slice_indices = []

    if redis_manager.is_connected:
        for i in range(start_slice, end_slice + 1):
            if 0 <= i < total_slices:
                cached = await redis_manager.get_midi_notes_slice(midi_id, i)
                if cached:
                    visible_notes.extend(cached)
                    slice_indices.append(i)

    return {
        'visible_notes': visible_notes,
        'slice_indices': slice_indices,
        'total_slices': total_slices,
        'slice_duration': slice_duration,
        'viewport_start': viewport_start,
        'viewport_end': viewport_end
    }


def sliced_midi_to_dict(sliced_data: SlicedMidiData) -> Dict[str, Any]:
    return {
        'midi_id': sliced_data.midi_id,
        'total_duration': sliced_data.total_duration,
        'slice_duration': sliced_data.slice_duration,
        'total_slices': sliced_data.total_slices,
        'slices': [asdict(s) for s in sliced_data.slices],
        'track_summary': sliced_data.track_summary
    }
