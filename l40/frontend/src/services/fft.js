function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function hanning(N) {
  const w = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
  }
  return w;
}

export function hamming(N) {
  const w = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    w[n] = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (N - 1));
  }
  return w;
}

export function blackman(N) {
  const w = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    w[n] =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * n) / (N - 1)) +
      0.08 * Math.cos((4 * Math.PI * n) / (N - 1));
  }
  return w;
}

function bitReverse(n, bits) {
  let reversed = 0;
  for (let i = 0; i < bits; i++) {
    reversed = (reversed << 1) | (n & 1);
    n >>= 1;
  }
  return reversed;
}

function bitLength(n) {
  let bits = 0;
  while ((1 << bits) < n) bits++;
  return bits;
}

export function fft(input) {
  const N = input.length;
  if (N === 0) return [];

  const paddedN = nextPowerOf2(N);
  const bits = bitLength(paddedN);

  const re = new Float64Array(paddedN);
  const im = new Float64Array(paddedN);

  for (let i = 0; i < N; i++) {
    re[bitReverse(i, bits)] = input[i];
  }

  for (let size = 2; size <= paddedN; size *= 2) {
    const halfSize = size / 2;
    const angle = (-2 * Math.PI) / size;

    for (let i = 0; i < paddedN; i += size) {
      for (let k = 0; k < halfSize; k++) {
        const theta = angle * k;
        const cosVal = Math.cos(theta);
        const sinVal = Math.sin(theta);

        const evenIdx = i + k;
        const oddIdx = i + k + halfSize;

        const tRe = cosVal * re[oddIdx] - sinVal * im[oddIdx];
        const tIm = sinVal * re[oddIdx] + cosVal * im[oddIdx];

        re[oddIdx] = re[evenIdx] - tRe;
        im[oddIdx] = im[evenIdx] - tIm;
        re[evenIdx] = re[evenIdx] + tRe;
        im[evenIdx] = im[evenIdx] + tIm;
      }
    }
  }

  const result = new Float64Array(paddedN * 2);
  for (let i = 0; i < paddedN; i++) {
    result[i * 2] = re[i];
    result[i * 2 + 1] = im[i];
  }

  return result;
}

export function computeMagnitudeSpectrum(complexArray) {
  const N = complexArray.length / 2;
  const halfN = Math.floor(N / 2);
  const magnitude = new Float64Array(halfN);

  for (let i = 0; i < halfN; i++) {
    const re = complexArray[i * 2];
    const im = complexArray[i * 2 + 1];
    magnitude[i] = Math.sqrt(re * re + im * im) / N;
  }

  return magnitude;
}

export function computePowerSpectrum(complexArray) {
  const N = complexArray.length / 2;
  const halfN = Math.floor(N / 2);
  const power = new Float64Array(halfN);

  for (let i = 0; i < halfN; i++) {
    const re = complexArray[i * 2];
    const im = complexArray[i * 2 + 1];
    power[i] = (re * re + im * im) / (N * N);
  }

  return power;
}

export function findPeakFrequencies(magnitude, sampleRate, numPeaks = 5) {
  const N = magnitude.length;
  const freqResolution = sampleRate / (2 * N);

  const peaks = [];
  for (let i = 1; i < N - 1; i++) {
    if (magnitude[i] > magnitude[i - 1] && magnitude[i] > magnitude[i + 1]) {
      peaks.push({ freq: i * freqResolution, magnitude: magnitude[i], bin: i });
    }
  }

  peaks.sort((a, b) => b.magnitude - a.magnitude);
  return peaks.slice(0, numPeaks);
}

export function bandEnergy(magnitude, sampleRate, lowFreq, highFreq) {
  const N = magnitude.length;
  const freqResolution = sampleRate / (2 * N);

  let energy = 0;
  const lowBin = Math.max(0, Math.floor(lowFreq / freqResolution));
  const highBin = Math.min(N - 1, Math.ceil(highFreq / freqResolution));

  for (let i = lowBin; i <= highBin; i++) {
    energy += magnitude[i] * magnitude[i];
  }

  return energy;
}

export function applyWindow(data, windowFunc) {
  const w = windowFunc(data.length);
  const windowed = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    windowed[i] = data[i] * w[i];
  }
  return windowed;
}

export function zeroPad(data, targetLength) {
  if (targetLength <= data.length) return Float64Array.from(data);
  const padded = new Float64Array(targetLength);
  padded.set(data);
  return padded;
}

export function fftWithWindow(data, sampleRate, windowFunc = hanning) {
  const windowed = applyWindow(data, windowFunc);
  const N = nextPowerOf2(windowed.length);
  const padded = zeroPad(windowed, N);
  const complex = fft(padded);
  const magnitude = computeMagnitudeSpectrum(complex);
  const power = computePowerSpectrum(complex);

  return {
    magnitude,
    power,
    complex,
    frequencies: Array.from({ length: magnitude.length }, (_, i) => (i * sampleRate) / (2 * N)),
    sampleRate,
    fftSize: N,
  };
}
