#include <emscripten.h>
#include <emscripten/bind.h>
#include <vector>
#include <complex>
#include <cmath>
#include <cstring>
#include <algorithm>

using namespace emscripten;

const int FINGERPRINT_SIZE = 32;
const int SAMPLE_RATE = 44100;
const int FFT_SIZE = 1024;
const int HOP_SIZE = 512;
const int NUM_BANDS = 32;

static float windowCache[FFT_SIZE];
static bool windowInitialized = false;

static void ensureWindow() {
    if (!windowInitialized) {
        for (int i = 0; i < FFT_SIZE; i++) {
            windowCache[i] = 0.5f * (1.0f - cos(2.0f * M_PI * i / (FFT_SIZE - 1)));
        }
        windowInitialized = true;
    }
}

static void fftInPlace(std::complex<float>* data, int n, bool inverse) {
    if (n <= 1) return;

    for (int i = 1, j = 0; i < n; i++) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) {
            j ^= bit;
        }
        j ^= bit;
        if (i < j) std::swap(data[i], data[j]);
    }

    for (int len = 2; len <= n; len <<= 1) {
        float angle = 2 * M_PI / len * (inverse ? -1 : 1);
        std::complex<float> wn(cos(angle), sin(angle));

        for (int i = 0; i < n; i += len) {
            std::complex<float> w(1);
            for (int j = 0; j < len / 2; j++) {
                auto u = data[i + j];
                auto v = data[i + j + len / 2] * w;
                data[i + j] = u + v;
                data[i + j + len / 2] = u - v;
                if (inverse) {
                    data[i + j] /= 2;
                    data[i + j + len / 2] /= 2;
                }
                w *= wn;
            }
        }
    }
}

static void computeSpectrum(const float* audio, size_t audioLen, size_t offset, float* spectrum) {
    std::complex<float> fftData[FFT_SIZE];
    memset(fftData, 0, sizeof(fftData));

    for (int i = 0; i < FFT_SIZE && (offset + i) < audioLen; i++) {
        fftData[i] = audio[offset + i] * windowCache[i];
    }

    fftInPlace(fftData, FFT_SIZE, false);

    int samplesPerBand = (FFT_SIZE / 2) / NUM_BANDS;

    for (int band = 0; band < NUM_BANDS; band++) {
        float energy = 0.0f;
        for (int i = 0; i < samplesPerBand; i++) {
            int idx = band * samplesPerBand + i;
            if (idx < FFT_SIZE / 2) {
                energy += std::abs(fftData[idx]);
            }
        }
        spectrum[band] = energy / samplesPerBand;
    }
}

class FingerprintExtractor {
public:
    FingerprintExtractor() {
        ensureWindow();
    }

    std::vector<uint8_t> extract(const std::vector<float>& audio) {
        std::vector<uint8_t> fingerprint(FINGERPRINT_SIZE, 0);

        if (audio.size() < FFT_SIZE) {
            return fingerprint;
        }

        size_t numFrames = (audio.size() - FFT_SIZE) / HOP_SIZE + 1;

        float meanSpectrum[NUM_BANDS] = {};
        float spectrum[NUM_BANDS];

        float* spectraFlat = new(std::nothrow) float[numFrames * NUM_BANDS];
        if (!spectraFlat) return fingerprint;

        for (size_t frame = 0; frame < numFrames; frame++) {
            size_t offset = frame * HOP_SIZE;
            computeSpectrum(audio.data(), audio.size(), offset, spectrum);
            memcpy(spectraFlat + frame * NUM_BANDS, spectrum, sizeof(spectrum));

            for (int i = 0; i < NUM_BANDS; i++) {
                meanSpectrum[i] += spectrum[i];
            }
        }

        for (int i = 0; i < NUM_BANDS; i++) {
            meanSpectrum[i] /= numFrames;
        }

        size_t bitsPerFrame = FINGERPRINT_SIZE * 8 / std::max((size_t)1, numFrames);
        bitsPerFrame = std::max((size_t)8, std::min((size_t)32, bitsPerFrame));

        int bitIndex = 0;
        for (size_t frame = 0; frame < numFrames && bitIndex < FINGERPRINT_SIZE * 8; frame++) {
            const float* spec = spectraFlat + frame * NUM_BANDS;

            for (size_t i = 0; i < bitsPerFrame && bitIndex < FINGERPRINT_SIZE * 8; i++) {
                size_t bandIdx = (i + frame * 3) % NUM_BANDS;
                bool bit = spec[bandIdx] > meanSpectrum[bandIdx];

                if (bit) {
                    fingerprint[bitIndex / 8] |= (1 << (bitIndex % 8));
                }
                bitIndex++;
            }
        }

        delete[] spectraFlat;

        return fingerprint;
    }
};

EMSCRIPTEN_BINDINGS(fingerprint) {
    class_<FingerprintExtractor>("FingerprintExtractor")
        .constructor<>()
        .function("extract", &FingerprintExtractor::extract);

    register_vector<float>("VectorFloat");
    register_vector<uint8_t>("VectorUint8");
}

static uint8_t* fingerprintBuffer = nullptr;
static int fingerprintBufferSize = 0;

extern "C" {
    EMSCRIPTEN_KEEPALIVE
    uint8_t* extract_fingerprint(const float* audio_data, int audio_length, int* out_length) {
        if (fingerprintBuffer) {
            free(fingerprintBuffer);
            fingerprintBuffer = nullptr;
        }

        FingerprintExtractor extractor;
        std::vector<float> audio(audio_data, audio_data + audio_length);
        std::vector<uint8_t> result = extractor.extract(audio);

        *out_length = result.size();
        fingerprintBufferSize = result.size();
        fingerprintBuffer = (uint8_t*)malloc(result.size());
        if (fingerprintBuffer) {
            memcpy(fingerprintBuffer, result.data(), result.size());
        }

        return fingerprintBuffer;
    }

    EMSCRIPTEN_KEEPALIVE
    void free_fingerprint_result(uint8_t* ptr) {
        if (ptr == fingerprintBuffer) {
            free(fingerprintBuffer);
            fingerprintBuffer = nullptr;
            fingerprintBufferSize = 0;
        }
    }

    EMSCRIPTEN_KEEPALIVE
    int hamming_distance(const uint8_t* a, const uint8_t* b, int length) {
        int distance = 0;
        for (int i = 0; i < length; i++) {
            unsigned int xor_val = (unsigned int)(a[i] ^ b[i]);
            while (xor_val) {
                distance += xor_val & 1;
                xor_val >>= 1;
            }
        }
        return distance;
    }
}
