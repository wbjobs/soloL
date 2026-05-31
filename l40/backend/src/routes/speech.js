import express from 'express';

const router = express.Router();

let cachedToken = null;
let tokenExpiry = null;

async function fetchAzureToken() {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  const endpoint = process.env.AZURE_SPEECH_ENDPOINT;

  if (!key || !region || !endpoint) {
    throw new Error('Azure Speech configuration missing');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-type': 'application/x-www-form-urlencoded',
      'Content-Length': 0,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch token: ${response.statusText}`);
  }

  const token = await response.text();
  return token;
}

async function getValidToken() {
  const now = Date.now();
  const cacheDuration = 9 * 60 * 1000;

  if (cachedToken && tokenExpiry && now < tokenExpiry) {
    return cachedToken;
  }

  const token = await fetchAzureToken();
  cachedToken = token;
  tokenExpiry = now + cacheDuration;
  return token;
}

router.get('/token', async (req, res) => {
  try {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;

    if (!key || key === 'your_azure_speech_key') {
      return res.json({
        token: null,
        region: region || 'eastasia',
        demoMode: true,
      });
    }

    const token = await getValidToken();
    res.json({
      token,
      region: region || 'eastasia',
      demoMode: false,
    });
  } catch (err) {
    console.error('Speech token error:', err);
    res.json({
      token: null,
      region: process.env.AZURE_SPEECH_REGION || 'eastasia',
      demoMode: true,
      error: err.message,
    });
  }
});

export default router;
