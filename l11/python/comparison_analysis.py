import json
import sys
import os
import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, asdict, field

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

@dataclass
class KDEPoint:
    x: float
    y1: float
    y2: float
    diff: float
    significant: bool

@dataclass
class KDEComparison:
    points: List[KDEPoint]
    bandwidth: float
    x_min: float
    x_max: float
    y1_max: float
    y2_max: float
    mean_diff: float
    std_diff: float
    overlapping_area: float
    peak_positions: List[Dict]

@dataclass
class ChordRoseData:
    names: List[str]
    values1: List[float]
    values2: List[float]
    angles: List[float]
    max_value: float

@dataclass
class ComparisonResult:
    analysis1_id: str
    analysis2_id: str
    name1: str
    name2: str
    rhythm_kde: KDEComparison
    chord_rose: ChordRoseData
    basic_stats: Dict
    similarity_score: float

def gaussian_kde(x: np.ndarray, bandwidth: float = None) -> Tuple[np.ndarray, np.ndarray, float]:
    if len(x) == 0:
        return np.array([]), np.array([]), 1.0
    
    x = np.array(x, dtype=np.float64)
    n = len(x)
    
    if bandwidth is None:
        std = np.std(x)
        if std == 0:
            std = 1.0
        bandwidth = 1.06 * std * (n ** (-0.2))
    
    x_min = x.min() - 3 * bandwidth
    x_max = x.max() + 3 * bandwidth
    x_grid = np.linspace(x_min, x_max, 200)
    
    kernel_matrix = np.exp(-0.5 * ((x_grid[:, None] - x[None, :]) / bandwidth) ** 2)
    density = kernel_matrix.sum(axis=1) / (n * bandwidth * np.sqrt(2 * np.pi))
    
    return x_grid, density, bandwidth

def compute_rhythm_intervals(notes: List[Dict]) -> np.ndarray:
    if len(notes) < 2:
        return np.array([])
    
    start_times = sorted([n.get('start_time', 0) for n in notes])
    intervals = np.diff(start_times)
    intervals = intervals[intervals > 0.01]
    
    if len(intervals) > 1000:
        intervals = np.sort(intervals)
        indices = np.linspace(0, len(intervals) - 1, 1000).astype(int)
        intervals = intervals[indices]
    
    return intervals

def compute_kde_comparison(
    notes1: List[Dict], 
    notes2: List[Dict],
    name1: str = 'Track 1',
    name2: str = 'Track 2'
) -> KDEComparison:
    intervals1 = compute_rhythm_intervals(notes1)
    intervals2 = compute_rhythm_intervals(notes2)
    
    if len(intervals1) == 0 or len(intervals2) == 0:
        return KDEComparison(
            points=[],
            bandwidth=1.0,
            x_min=0,
            x_max=10,
            y1_max=0,
            y2_max=0,
            mean_diff=0,
            std_diff=0,
            overlapping_area=0,
            peak_positions=[]
        )
    
    all_intervals = np.concatenate([intervals1, intervals2])
    global_std = np.std(all_intervals)
    if global_std == 0:
        global_std = 1.0
    bandwidth = 1.06 * global_std * (len(all_intervals) ** (-0.2))
    
    x1, y1, bw1 = gaussian_kde(intervals1, bandwidth)
    x2, y2, bw2 = gaussian_kde(intervals2, bandwidth)
    
    x_min = min(x1.min(), x2.min())
    x_max = max(x1.max(), x2.max())
    x_grid = np.linspace(x_min, x_max, 200)
    
    from scipy.interpolate import interp1d
    f1 = interp1d(x1, y1, kind='linear', bounds_error=False, fill_value=0)
    f2 = interp1d(x2, y2, kind='linear', bounds_error=False, fill_value=0)
    
    y1_interp = f1(x_grid)
    y2_interp = f2(x_grid)
    
    diff = y1_interp - y2_interp
    y_max = max(y1_interp.max(), y2_interp.max())
    threshold = y_max * 0.05
    significant = np.abs(diff) > threshold
    
    min_density = np.minimum(y1_interp, y2_interp)
    overlapping_area = np.trapz(min_density, x_grid)
    total_area = np.trapz(np.maximum(y1_interp, y2_interp), x_grid)
    overlapping_ratio = overlapping_area / total_area if total_area > 0 else 0
    
    from scipy.signal import find_peaks
    peaks1, _ = find_peaks(y1_interp, height=y_max * 0.1, distance=5)
    peaks2, _ = find_peaks(y2_interp, height=y_max * 0.1, distance=5)
    
    peak_positions = [
        {'track': name1, 'x': float(x_grid[p]), 'y': float(y1_interp[p])} for p in peaks1
    ] + [
        {'track': name2, 'x': float(x_grid[p]), 'y': float(y2_interp[p])} for p in peaks2
    ]
    
    points = [
        KDEPoint(
            x=float(x_grid[i]),
            y1=float(y1_interp[i]),
            y2=float(y2_interp[i]),
            diff=float(diff[i]),
            significant=bool(significant[i])
        )
        for i in range(len(x_grid))
    ]
    
    return KDEComparison(
        points=points,
        bandwidth=float(bandwidth),
        x_min=float(x_min),
        x_max=float(x_max),
        y1_max=float(y1_interp.max()),
        y2_max=float(y2_interp.max()),
        mean_diff=float(np.mean(diff)),
        std_diff=float(np.std(diff)),
        overlapping_area=float(overlapping_ratio),
        peak_positions=peak_positions
    )

def normalize_chord_name(name: str) -> str:
    name = name.strip().lower()
    for suffix in [' major', ' minor', '7', 'maj7', 'min7', 'dim', 'aug', 'sus4', 'sus2']:
        name = name.replace(suffix, '')
    return name.strip().title()

def compute_chord_rose(
    chords1: List[Dict], 
    chords2: List[Dict],
    max_chords: int = 12
) -> ChordRoseData:
    def count_chords(chords):
        counts = {}
        for chord in chords:
            name = normalize_chord_name(chord.get('name', 'Unknown'))
            duration = chord.get('duration', 1)
            counts[name] = counts.get(name, 0) + duration
        return counts
    
    counts1 = count_chords(chords1)
    counts2 = count_chords(chords2)
    
    all_names = set(counts1.keys()) | set(counts2.keys())
    all_names = sorted(all_names, key=lambda n: -(counts1.get(n, 0) + counts2.get(n, 0)))[:max_chords]
    
    values1 = [counts1.get(name, 0) for name in all_names]
    values2 = [counts2.get(name, 0) for name in all_names]
    
    max_value = max(max(values1), max(values2), 1)
    angles = [i * 2 * np.pi / len(all_names) for i in range(len(all_names))]
    
    return ChordRoseData(
        names=all_names,
        values1=values1,
        values2=values2,
        angles=[float(a) for a in angles],
        max_value=float(max_value)
    )

def compute_basic_stats(
    analysis1: Dict, 
    analysis2: Dict
) -> Dict:
    def get_difference(v1, v2):
        if v1 is None or v2 is None:
            return None
        return float(v1) - float(v2)
    
    stats = {
        'tempo_diff': get_difference(analysis1.get('tempo_bpm'), analysis2.get('tempo_bpm')),
        'duration_diff': get_difference(analysis1.get('duration_seconds'), analysis2.get('duration_seconds')),
        'note_count_diff': get_difference(analysis1.get('note_count'), analysis2.get('note_count')),
        'track_count_diff': get_difference(analysis1.get('track_count'), analysis2.get('track_count')),
        'time_signature1': analysis1.get('time_signature'),
        'time_signature2': analysis2.get('time_signature'),
        'key_signature1': analysis1.get('key_signature'),
        'key_signature2': analysis2.get('key_signature'),
        'primary_genre1': analysis1.get('primary_genre'),
        'primary_genre2': analysis2.get('primary_genre'),
        'primary_emotion1': analysis1.get('primary_emotion'),
        'primary_emotion2': analysis2.get('primary_emotion'),
    }
    return stats

def compute_similarity_score(kde: KDEComparison, rose: ChordRoseData) -> float:
    rhythm_similarity = kde.overlapping_area if kde.overlapping_area > 0 else 0
    
    v1 = np.array(rose.values1)
    v2 = np.array(rose.values2)
    if v1.sum() > 0 and v2.sum() > 0:
        v1_norm = v1 / v1.sum()
        v2_norm = v2 / v2.sum()
        chord_similarity = np.sum(np.minimum(v1_norm, v2_norm))
    else:
        chord_similarity = 0.5
    
    similarity = 0.6 * rhythm_similarity + 0.4 * chord_similarity
    return float(min(max(similarity, 0), 1))

def compare_analyses(
    analysis1: Dict, 
    analysis2: Dict,
    notes1: List[Dict],
    notes2: List[Dict],
    chords1: List[Dict],
    chords2: List[Dict]
) -> ComparisonResult:
    name1 = analysis1.get('original_name', 'Track 1')
    name2 = analysis2.get('original_name', 'Track 2')
    
    kde = compute_kde_comparison(notes1, notes2, name1, name2)
    chord_rose = compute_chord_rose(chords1, chords2)
    basic_stats = compute_basic_stats(analysis1, analysis2)
    similarity = compute_similarity_score(kde, chord_rose)
    
    return ComparisonResult(
        analysis1_id=analysis1.get('id', ''),
        analysis2_id=analysis2.get('id', ''),
        name1=name1,
        name2=name2,
        rhythm_kde=kde,
        chord_rose=chord_rose,
        basic_stats=basic_stats,
        similarity_score=similarity
    )

def comparison_to_dict(result: ComparisonResult) -> Dict:
    return {
        'analysis1_id': result.analysis1_id,
        'analysis2_id': result.analysis2_id,
        'name1': result.name1,
        'name2': result.name2,
        'rhythm_kde': {
            'points': [asdict(p) for p in result.rhythm_kde.points],
            'bandwidth': result.rhythm_kde.bandwidth,
            'x_min': result.rhythm_kde.x_min,
            'x_max': result.rhythm_kde.x_max,
            'y1_max': result.rhythm_kde.y1_max,
            'y2_max': result.rhythm_kde.y2_max,
            'mean_diff': result.rhythm_kde.mean_diff,
            'std_diff': result.rhythm_kde.std_diff,
            'overlapping_area': result.rhythm_kde.overlapping_area,
            'peak_positions': result.rhythm_kde.peak_positions,
        },
        'chord_rose': {
            'names': result.chord_rose.names,
            'values1': result.chord_rose.values1,
            'values2': result.chord_rose.values2,
            'angles': result.chord_rose.angles,
            'max_value': result.chord_rose.max_value,
        },
        'basic_stats': result.basic_stats,
        'similarity_score': result.similarity_score,
    }

if __name__ == '__main__':
    try:
        input_data = json.loads(sys.stdin.readline())
        if isinstance(input_data, str):
            input_data = json.loads(input_data)
        
        result = compare_analyses(
            input_data['analysis1'],
            input_data['analysis2'],
            input_data['notes1'],
            input_data['notes2'],
            input_data['chords1'],
            input_data['chords2']
        )
        
        print(json.dumps(comparison_to_dict(result)))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)
