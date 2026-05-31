export interface BrowserInfo {
  isSafari: boolean;
  isChrome: boolean;
  isFirefox: boolean;
  isIOS: boolean;
  majorVersion: number;
  supportsWebGL2: boolean;
  supportsOffscreenCanvas: boolean;
}

export function detectBrowser(): BrowserInfo {
  const ua = navigator.userAgent;

  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isChrome = /chrome|chromium|crios/i.test(ua) && !/edge|edg/i.test(ua);
  const isFirefox = /firefox|fxios/i.test(ua);
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let majorVersion = 0;
  if (isSafari) {
    const match = ua.match(/version\/(\d+)/i);
    majorVersion = match ? parseInt(match[1], 10) : 0;
  } else if (isChrome) {
    const match = ua.match(/chrome\/(\d+)/i);
    majorVersion = match ? parseInt(match[1], 10) : 0;
  } else if (isFirefox) {
    const match = ua.match(/firefox\/(\d+)/i);
    majorVersion = match ? parseInt(match[1], 10) : 0;
  }

  const testCanvas = document.createElement('canvas');
  const supportsWebGL2 = !!(testCanvas.getContext('webgl2'));
  const supportsOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';

  return {
    isSafari,
    isChrome,
    isFirefox,
    isIOS,
    majorVersion,
    supportsWebGL2,
    supportsOffscreenCanvas
  };
}

export function getSafariOptimizedConfig() {
  const browser = detectBrowser();
  return {
    useLightweightModel: browser.isSafari,
    inputResolution: browser.isSafari ? { width: 224, height: 224 } : { width: 1920, height: 1080 },
    modelSelection: browser.isSafari ? 0 : 1,
    enableWebGLPack: browser.isSafari,
    prefersOffscreenCanvas: browser.isSafari && browser.supportsOffscreenCanvas
  };
}
