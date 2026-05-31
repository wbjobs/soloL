import numpy as np
from scipy import signal
from typing import List, Dict, Any, Tuple
from dataclasses import dataclass
import io
import base64
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


@dataclass
class SpectrumData:
    times: List[float]
    frequencies: List[float]
    spectrogram: List[List[float]]
    image_base64: str


def generate_spectrogram(
    notes: List[Dict[str, Any]],
    total_duration: float,
    sample_rate: int = 100,
    freq_resolution: int = 128,
    min_pitch: int = 21,
    max_pitch: int = 108
) -> SpectrumData:
    num_samples = int(total_duration * sample_rate)
    num_pitches = max_pitch - min_pitch + 1

    spec = np.zeros((num_pitches, num_samples))

    for note in notes:
        pitch = note['pitch']
        if min_pitch <= pitch <= max_pitch:
            pitch_idx = pitch - min_pitch
            start_sample = int(note['start_time'] * sample_rate)
            end_sample = int((note['start_time'] + note['duration']) * sample_rate)
            end_sample = min(end_sample, num_samples)
            if start_sample < num_samples:
                velocity = note['velocity'] / 127.0
                envelope = np.linspace(0.5, 1.0, end_sample - start_sample)
                envelope = envelope * velocity
                spec[pitch_idx, start_sample:end_sample] = np.maximum(
                    spec[pitch_idx, start_sample:end_sample],
                    envelope
                )

    spec = signal.medfilt2d(spec, kernel_size=(3, 3))
    spec = np.log1p(spec * 10) / np.log1p(10)

    times = np.linspace(0, total_duration, num_samples).tolist()
    frequencies = [(440.0 / 32.0) * (2.0 ** ((p + min_pitch - 9) / 12.0)) 
                   for p in range(num_pitches)]

    fig, ax = plt.subplots(figsize=(12, 6))
    im = ax.imshow(
        spec,
        aspect='auto',
        origin='lower',
        cmap='viridis',
        extent=[0, total_duration, min_pitch, max_pitch]
    )
    ax.set_xlabel('Time (s)')
    ax.set_ylabel('MIDI Pitch')
    ax.set_title('Spectrum Waterfall')
    plt.colorbar(im, ax=ax, label='Intensity')
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=100)
    buf.seek(0)
    image_base64 = base64.b64encode(buf.read()).decode('utf-8')
    plt.close(fig)

    return SpectrumData(
        times=times,
        frequencies=frequencies,
        spectrogram=spec.tolist(),
        image_base64=image_base64
    )


def spectrum_to_dict(spec_data: SpectrumData) -> Dict[str, Any]:
    return {
        'times': spec_data.times,
        'frequencies': spec_data.frequencies,
        'spectrogram': spec_data.spectrogram,
        'image_base64': spec_data.image_base64
    }
