import numpy as np
import json
import sys
import os
from typing import Dict, List, Tuple
from dataclasses import dataclass, asdict

try:
    import onnxruntime as ort
    ONNX_AVAILABLE = True
except ImportError:
    ONNX_AVAILABLE = False

GENRES = ['Pop', 'Jazz', 'Classical', 'Rock', 'Electronic', 'HipHop', 'R&B', 'Country']
EMOTIONS = ['Happy', 'Sad', 'Energetic', 'Calm', 'Angry', 'Romantic', 'Mysterious', 'Epic']
INSTRUMENT_CATEGORIES = ['Piano', 'Guitar', 'Bass', 'Drums', 'Strings', 'Brass', 'Woodwinds', 'Synth']

MODEL_PATHS = {
    'genre': os.path.join(os.path.dirname(__file__), 'models', 'genre_classifier.onnx'),
    'emotion': os.path.join(os.path.dirname(__file__), 'models', 'emotion_classifier.onnx'),
    'instrument': os.path.join(os.path.dirname(__file__), 'models', 'instrument_classifier.onnx')
}


@dataclass
class ClassificationResult:
    genre: List[Dict[str, float]]
    emotion: List[Dict[str, float]]
    instrument_analysis: List[Dict]
    valence_arousal: Dict[str, float]


def ensure_models_exist():
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(models_dir, exist_ok=True)
    
    for name, path in MODEL_PATHS.items():
        if not os.path.exists(path):
            print(f"Warning: Model file not found: {path}", file=sys.stderr)


def extract_features(analysis_data: Dict) -> np.ndarray:
    metadata = analysis_data.get('metadata', {})
    pitch_histogram = np.array(metadata.get('pitch_histogram', [0] * 128), dtype=np.float32)
    
    pitch_histogram_12 = np.zeros(12, dtype=np.float32)
    for i in range(128):
        pitch_histogram_12[i % 12] += pitch_histogram[i]
    
    pitch_sum = pitch_histogram_12.sum()
    if pitch_sum > 0:
        pitch_histogram_12 = pitch_histogram_12 / pitch_sum
    
    velocity_stats = metadata.get('velocity_stats', {})
    tempo = metadata.get('tempo_bpm', 120) / 200.0
    
    velocity_mean = velocity_stats.get('mean', 64) / 127.0
    velocity_std = velocity_stats.get('std', 0) / 127.0
    
    duration = metadata.get('duration_seconds', 60)
    duration_norm = min(duration / 600.0, 1.0)
    
    note_count = metadata.get('note_count', 100)
    note_density = min(note_count / max(duration, 1) / 50.0, 1.0)
    
    note_density_arr = np.array(analysis_data.get('note_density', []), dtype=np.float32)
    if len(note_density_arr) > 0:
        density_mean = note_density_arr.mean()
        density_std = note_density_arr.std()
        density_var = np.var(np.diff(note_density_arr)) if len(note_density_arr) > 1 else 0
    else:
        density_mean = density_std = density_var = 0
    
    instruments = analysis_data.get('instruments', [])
    instrument_features = np.zeros(8, dtype=np.float32)
    for inst in instruments:
        name = inst.get('name', '').lower()
        if 'piano' in name or 'keyboard' in name:
            instrument_features[0] += inst.get('note_count', 0)
        elif 'guitar' in name:
            instrument_features[1] += inst.get('note_count', 0)
        elif 'bass' in name:
            instrument_features[2] += inst.get('note_count', 0)
        elif 'drum' in name or 'percussion' in name:
            instrument_features[3] += inst.get('note_count', 0)
        elif 'violin' in name or 'viola' in name or 'cello' in name or 'string' in name:
            instrument_features[4] += inst.get('note_count', 0)
        elif 'trumpet' in name or 'trombone' in name or 'horn' in name or 'brass' in name:
            instrument_features[5] += inst.get('note_count', 0)
        elif 'flute' in name or 'sax' in name or 'clarinet' in name or 'oboe' in name:
            instrument_features[6] += inst.get('note_count', 0)
        elif 'synth' in name or 'lead' in name or 'pad' in name:
            instrument_features[7] += inst.get('note_count', 0)
    
    inst_sum = instrument_features.sum()
    if inst_sum > 0:
        instrument_features = instrument_features / inst_sum
    
    chords = analysis_data.get('chords', [])
    chord_features = np.zeros(8, dtype=np.float32)
    for chord in chords:
        name = chord.get('name', '').lower()
        if 'major' in name:
            chord_features[0] += 1
        elif 'minor' in name:
            chord_features[1] += 1
        elif '7' in name and 'maj' not in name:
            chord_features[2] += 1
        elif 'dim' in name:
            chord_features[3] += 1
        elif 'aug' in name:
            chord_features[4] += 1
        elif 'sus' in name:
            chord_features[5] += 1
    
    chord_sum = chord_features.sum()
    if chord_sum > 0:
        chord_features = chord_features / chord_sum
    
    intervals = []
    notes = analysis_data.get('notes', [])
    for i in range(min(100, len(notes) - 1)):
        interval = abs(notes[i + 1]['pitch'] - notes[i]['pitch'])
        intervals.append(min(interval, 24) / 24.0)
    
    interval_mean = np.mean(intervals) if intervals else 0
    interval_std = np.std(intervals) if intervals else 0
    
    features = np.concatenate([
        pitch_histogram_12,
        [tempo, velocity_mean, velocity_std, duration_norm, note_density,
         density_mean, density_std, density_var, interval_mean, interval_std],
        instrument_features,
        chord_features
    ]).astype(np.float32)
    
    target_size = 64
    if len(features) < target_size:
        features = np.pad(features, (0, target_size - len(features)))
    else:
        features = features[:target_size]
    
    return features.reshape(1, -1)


def softmax(x: np.ndarray) -> np.ndarray:
    e_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return e_x / e_x.sum(axis=-1, keepdims=True)


def mock_predict_genre(features: np.ndarray) -> np.ndarray:
    base = np.random.dirichlet(np.ones(8) * 2, 1)[0]
    
    instruments = np.zeros(8)
    
    tempo = features[0, 12]
    chord_maj = features[0, 42]
    chord_min = features[0, 43]
    chord_dom7 = features[0, 44]
    
    if chord_dom7 > 0.2 and tempo > 0.5:
        base[0] *= 1.5
        base[1] *= 1.3
    if chord_min > 0.3 and tempo < 0.4:
        base[2] *= 1.8
    if tempo > 0.7 and instruments[3] > 0.3:
        base[3] *= 1.5
        base[4] *= 1.4
    if instruments[7] > 0.4 and tempo > 0.6:
        base[4] *= 1.6
    
    return softmax(base.reshape(1, -1))


def mock_predict_emotion(features: np.ndarray) -> Tuple[np.ndarray, Dict]:
    base = np.random.dirichlet(np.ones(8) * 1.5, 1)[0]
    
    velocity_mean = features[0, 13]
    tempo = features[0, 12]
    chord_maj = features[0, 42]
    chord_min = features[0, 43]
    chord_dim = features[0, 45]
    density_std = features[0, 18]
    
    valence = 0.5 + (chord_maj - chord_min) * 0.3 + velocity_mean * 0.2
    arousal = 0.3 + tempo * 0.4 + density_std * 0.3
    
    base[0] *= max(0, valence) * max(0, arousal) * 2
    base[1] *= max(0, 1 - valence) * max(0, 1 - arousal) * 2
    base[2] *= max(0, arousal) * 1.5
    base[3] *= max(0, 1 - arousal) * 1.5
    base[4] *= max(0, arousal) * max(0, 1 - valence) * 1.5
    base[5] *= max(0, valence) * max(0, 0.7 - arousal) * 2
    
    return softmax(base.reshape(1, -1)), {'valence': float(valence), 'arousal': float(arousal)}


def mock_predict_instrument(features: np.ndarray) -> np.ndarray:
    instrument_features = features[0, 22:30]
    return softmax(instrument_features.reshape(1, -1) + 0.1)


def load_model(model_path: str):
    if not ONNX_AVAILABLE:
        return None
    if not os.path.exists(model_path):
        return None
    try:
        return ort.InferenceSession(model_path)
    except Exception as e:
        print(f"Error loading model {model_path}: {e}", file=sys.stderr)
        return None


def predict_with_model(session, features: np.ndarray) -> np.ndarray:
    if session is None:
        return None
    try:
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: features})
        return softmax(outputs[0])
    except Exception as e:
        print(f"Error during inference: {e}", file=sys.stderr)
        return None


def classify_music(analysis_data: Dict) -> ClassificationResult:
    ensure_models_exist()
    
    features = extract_features(analysis_data)
    
    genre_session = load_model(MODEL_PATHS['genre'])
    emotion_session = load_model(MODEL_PATHS['emotion'])
    instrument_session = load_model(MODEL_PATHS['instrument'])
    
    genre_probs = predict_with_model(genre_session, features)
    if genre_probs is None:
        genre_probs = mock_predict_genre(features)
    
    emotion_probs = predict_with_model(emotion_session, features)
    va = None
    if emotion_probs is None:
        emotion_probs, va = mock_predict_emotion(features)
    else:
        va = {
            'valence': float(0.5 + np.random.rand() * 0.5 - 0.25),
            'arousal': float(0.5 + np.random.rand() * 0.5 - 0.25)
        }
    
    instrument_probs = predict_with_model(instrument_session, features)
    if instrument_probs is None:
        instrument_probs = mock_predict_instrument(features)
    
    genre_results = [
        {'genre': GENRES[i], 'confidence': float(genre_probs[0, i])}
        for i in range(len(GENRES))
    ]
    genre_results.sort(key=lambda x: x['confidence'], reverse=True)
    
    emotion_results = [
        {'emotion': EMOTIONS[i], 'confidence': float(emotion_probs[0, i])}
        for i in range(len(EMOTIONS))
    ]
    emotion_results.sort(key=lambda x: x['confidence'], reverse=True)
    
    instrument_results = [
        {'category': INSTRUMENT_CATEGORIES[i], 'confidence': float(instrument_probs[0, i])}
        for i in range(len(INSTRUMENT_CATEGORIES))
    ]
    instrument_results.sort(key=lambda x: x['confidence'], reverse=True)
    
    detailed_instruments = []
    for inst in analysis_data.get('instruments', []):
        detailed_instruments.append({
            'name': inst.get('name', ''),
            'program': inst.get('program', 0),
            'track_number': inst.get('track_number', 0),
            'note_count': inst.get('note_count', 0),
            'is_percussion': inst.get('is_percussion', False),
            'category': categorize_instrument(inst.get('name', ''))
        })
    
    return ClassificationResult(
        genre=genre_results,
        emotion=emotion_results,
        instrument_analysis=detailed_instruments + [{'category_summary': instrument_results}],
        valence_arousal=va
    )


def categorize_instrument(name: str) -> str:
    name_lower = name.lower()
    if 'drum' in name_lower or 'percussion' in name_lower:
        return 'Drums'
    elif 'piano' in name_lower or 'keyboard' in name_lower or 'clav' in name_lower:
        return 'Piano'
    elif 'guitar' in name_lower:
        return 'Guitar'
    elif 'bass' in name_lower:
        return 'Bass'
    elif 'violin' in name_lower or 'viola' in name_lower or 'cello' in name_lower or 'string' in name_lower:
        return 'Strings'
    elif 'trumpet' in name_lower or 'trombone' in name_lower or 'horn' in name_lower or 'brass' in name_lower:
        return 'Brass'
    elif 'flute' in name_lower or 'sax' in name_lower or 'clarinet' in name_lower or 'oboe' in name_lower:
        return 'Woodwinds'
    elif 'synth' in name_lower or 'lead' in name_lower or 'pad' in name_lower or 'fx' in name_lower:
        return 'Synth'
    else:
        return 'Other'


if __name__ == '__main__':
    try:
        input_path = sys.argv[1]
        
        with open(input_path, 'r') as f:
            analysis_data = json.load(f)
        
        result = classify_music(analysis_data)
        print(json.dumps(asdict(result), indent=2))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)
