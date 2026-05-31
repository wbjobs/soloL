import axios from 'axios';

let recognizer = null;
let audioConfig = null;
let speechConfig = null;
let isRecognizing = false;
let retryCount = 0;
const maxRetries = 5;
let demoMode = false;
let demoInterval = null;
let speechSDK = null;

const callbacks = {
  onPartial: null,
  onFinal: null,
  onError: null,
  onStart: null,
  onStop: null,
};

async function loadSpeechSDK() {
  if (speechSDK) return speechSDK;
  try {
    if (window.SpeechSDK) {
      speechSDK = window.SpeechSDK;
      return speechSDK;
    }
    const sdkName = 'microsoft-cognitiveservices-speech-sdk';
    const sdk = await import(/* @vite-ignore */ sdkName);
    speechSDK = sdk;
    return sdk;
  } catch (err) {
    console.log('[Azure Speech] SDK not available, using demo mode');
    demoMode = true;
    return null;
  }
}

export async function getSpeechToken() {
  try {
    const res = await axios.get('/api/speech/token');
    return res.data;
  } catch (err) {
    console.error('[Azure Speech] Failed to get token:', err);
    return { token: null, region: 'eastasia', demoMode: true, error: err.message };
  }
}

function getBackoffDelay(attempt) {
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

async function initializeRecognizer() {
  const sdk = await loadSpeechSDK();
  if (!sdk) {
    demoMode = true;
    return;
  }

  const tokenData = await getSpeechToken();
  if (tokenData.demoMode || !tokenData.token) {
    demoMode = true;
    return;
  }

  demoMode = false;
  speechConfig = sdk.SpeechConfig.fromAuthorizationToken(tokenData.token, tokenData.region);
  speechConfig.speechRecognitionLanguage = 'en-US';
  audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
  recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognizing = (s, e) => {
    if (e.result.reason === sdk.ResultReason.RecognizingSpeech && callbacks.onPartial) {
      callbacks.onPartial(e.result.text);
    }
  };

  recognizer.recognized = (s, e) => {
    if (e.result.reason === sdk.ResultReason.RecognizedSpeech && callbacks.onFinal) {
      callbacks.onFinal(e.result.text);
    } else if (e.result.reason === sdk.ResultReason.NoMatch && callbacks.onError) {
      callbacks.onError(new Error('No speech could be recognized'));
    }
  };

  recognizer.canceled = (s, e) => {
    console.error('[Azure Speech] Recognition canceled:', e.errorDetails);
    if (callbacks.onError) {
      callbacks.onError(new Error(e.errorDetails || 'Recognition canceled'));
    }
    if (e.reason === sdk.CancellationReason.Error && isRecognizing) {
      handleRecognitionError();
    }
  };

  recognizer.sessionStopped = (s, e) => {
    console.log('[Azure Speech] Session stopped');
    if (isRecognizing && retryCount < maxRetries) {
      handleRecognitionError();
    } else {
      stopRecognition();
    }
  };
}

async function handleRecognitionError() {
  if (retryCount >= maxRetries) {
    console.error('[Azure Speech] Max retries exceeded, falling back to demo mode');
    demoMode = true;
    if (callbacks.onError) {
      callbacks.onError(new Error('Azure Speech unreachable, using local recording only'));
    }
    return;
  }

  retryCount++;
  const delay = getBackoffDelay(retryCount);
  console.log(`[Azure Speech] Retrying in ${delay}ms (attempt ${retryCount}/${maxRetries})`);

  setTimeout(async () => {
    if (!isRecognizing) return;
    try {
      if (recognizer) {
        try {
          recognizer.close();
        } catch (e) { /* ignore */ }
        recognizer = null;
      }
      await initializeRecognizer();
      if (recognizer && isRecognizing) {
        recognizer.startContinuousRecognitionAsync();
        retryCount = 0;
      }
    } catch (err) {
      handleRecognitionError();
    }
  }, delay);
}

function startDemoRecognition() {
  const phrases = [
    'Checking the equipment...',
    'I notice a small crack on the surface.',
    'The temperature reading is normal.',
    'There appears to be some corrosion.',
    'Pressure levels are within acceptable range.',
  ];

  let phraseIndex = 0;
  let charIndex = 0;
  let currentPhrase = phrases[0];
  let isTyping = true;

  demoInterval = setInterval(() => {
    if (!isRecognizing) {
      clearInterval(demoInterval);
      return;
    }

    if (isTyping) {
      charIndex++;
      const partial = currentPhrase.substring(0, charIndex);
      if (callbacks.onPartial) {
        callbacks.onPartial(partial);
      }
      if (charIndex >= currentPhrase.length) {
        isTyping = false;
        if (callbacks.onFinal) {
          callbacks.onFinal(currentPhrase);
        }
        setTimeout(() => {
          if (!isRecognizing) return;
          phraseIndex = (phraseIndex + 1) % phrases.length;
          currentPhrase = phrases[phraseIndex];
          charIndex = 0;
          isTyping = true;
        }, 1500);
      }
    }
  }, 80);

  if (callbacks.onStart) {
    callbacks.onStart();
  }
}

export async function startRecognition(options = {}) {
  if (isRecognizing) return;

  callbacks.onPartial = options.onPartial || null;
  callbacks.onFinal = options.onFinal || null;
  callbacks.onError = options.onError || null;
  callbacks.onStart = options.onStart || null;
  callbacks.onStop = options.onStop || null;

  isRecognizing = true;
  retryCount = 0;

  try {
    await initializeRecognizer();

    if (demoMode) {
      console.log('[Azure Speech] Starting demo mode recognition');
      startDemoRecognition();
      return { mode: 'demo' };
    }

    if (!recognizer) {
      throw new Error('Failed to initialize speech recognizer');
    }

    recognizer.startContinuousRecognitionAsync(
      () => {
        console.log('[Azure Speech] Recognition started');
        if (callbacks.onStart) {
          callbacks.onStart();
        }
      },
      (err) => {
        console.error('[Azure Speech] Start error:', err);
        if (callbacks.onError) {
          callbacks.onError(err);
        }
        handleRecognitionError();
      }
    );

    return { mode: 'azure' };
  } catch (err) {
    console.error('[Azure Speech] Failed to start recognition:', err);
    demoMode = true;
    startDemoRecognition();
    return { mode: 'demo' };
  }
}

export async function stopRecognition() {
  isRecognizing = false;

  if (demoInterval) {
    clearInterval(demoInterval);
    demoInterval = null;
  }

  if (recognizer) {
    try {
      await new Promise((resolve, reject) => {
        recognizer.stopContinuousRecognitionAsync(
          () => resolve(),
          (err) => reject(err)
        );
      });
      recognizer.close();
    } catch (err) {
      console.error('[Azure Speech] Error stopping recognition:', err);
    }
    recognizer = null;
  }

  if (audioConfig) {
    try {
      audioConfig.close();
    } catch (e) { /* ignore */ }
    audioConfig = null;
  }

  if (speechConfig) {
    speechConfig = null;
  }

  retryCount = 0;

  if (callbacks.onStop) {
    callbacks.onStop();
  }

  console.log('[Azure Speech] Recognition stopped');
}

export function isDemoMode() {
  return demoMode;
}

export function isCurrentlyRecognizing() {
  return isRecognizing;
}
