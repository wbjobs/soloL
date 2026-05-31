import { useRef, useEffect, useCallback, useState } from 'react';
import { SelfieSegmentation, Results } from '@mediapipe/selfie_segmentation';
import { Camera } from '@mediapipe/camera_utils';
import { BackgroundConfig } from '../types';
import { detectBrowser, getSafariOptimizedConfig } from '../utils/browserDetect';
import { createCachedLocateFile } from '../utils/modelCache';

interface UseSelfieSegmentationOptions {
  onResults?: (results: Results) => void;
}

function createOptimizedCanvas(width: number, height: number): HTMLCanvasElement {
  const browser = detectBrowser();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  if (browser.isSafari) {
    const ctx = canvas.getContext('2d', {
      willReadFrequently: false,
      alpha: false,
      desynchronized: true
    });
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
    }
  }

  return canvas;
}

export function useSelfieSegmentation(options: UseSelfieSegmentationOptions = {}) {
  const segmentationRef = useRef<SelfieSegmentation | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [background, setBackground] = useState<BackgroundConfig>({ type: 'none' });
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);
  const downscaleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const browserConfigRef = useRef(getSafariOptimizedConfig());

  const initialize = useCallback(async () => {
    const browserConfig = browserConfigRef.current;
    const browser = detectBrowser();

    const selfieSegmentation = new SelfieSegmentation({
      locateFile: createCachedLocateFile(
        'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747'
      )
    });

    selfieSegmentation.setOptions({
      modelSelection: browserConfig.modelSelection,
      selfieMode: true
    });

    if (browser.isSafari) {
      const res = browserConfig.inputResolution;
      downscaleCanvasRef.current = createOptimizedCanvas(res.width, res.height);
    }

    selfieSegmentation.onResults((results) => {
      if (outputCanvasRef.current) {
        renderSegmentation(results);
      }
      if (options.onResults) {
        options.onResults(results);
      }
    });

    await selfieSegmentation.initialize();
    segmentationRef.current = selfieSegmentation;
    setIsReady(true);

    return selfieSegmentation;
  }, [options]);

  const renderSegmentation = useCallback((results: Results) => {
    const canvas = outputCanvasRef.current;
    if (!canvas) return;

    const browser = detectBrowser();
    const ctxOptions = browser.isSafari
      ? { willReadFrequently: false, alpha: false, desynchronized: true } as CanvasRenderingContext2DSettings
      : undefined;

    const ctx = canvas.getContext('2d', ctxOptions);
    if (!ctx) return;

    const width = results.image.width;
    const height = results.image.height;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    if (background.type === 'blur' && browser.isSafari) {
      ctx.drawImage(results.segmentationMask, 0, 0, width, height);
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(results.image, 0, 0, width, height);

      ctx.globalCompositeOperation = 'destination-over';
      const blurPx = Math.min(background.blurAmount || 10, 20);
      ctx.filter = `blur(${blurPx}px)`;
      ctx.drawImage(results.image, 0, 0, width, height);
      ctx.filter = 'none';
    } else if (background.type !== 'none') {
      ctx.drawImage(results.segmentationMask, 0, 0, width, height);
      ctx.globalCompositeOperation = 'source-out';

      if (background.type === 'blur') {
        ctx.filter = `blur(${background.blurAmount || 10}px)`;
        ctx.drawImage(results.image, 0, 0, width, height);
        ctx.filter = 'none';
      } else if (background.type === 'image' && backgroundImageRef.current) {
        ctx.drawImage(backgroundImageRef.current, 0, 0, width, height);
      } else if (background.type === 'video' && backgroundVideoRef.current) {
        ctx.drawImage(backgroundVideoRef.current, 0, 0, width, height);
      } else {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, width, height);
      }

      ctx.globalCompositeOperation = 'destination-atop';
    }

    ctx.drawImage(results.image, 0, 0, width, height);
    ctx.restore();
  }, [background]);

  const startCamera = useCallback((videoElement: HTMLVideoElement) => {
    if (!segmentationRef.current) return;

    const browserConfig = browserConfigRef.current;
    const res = browserConfig.inputResolution;

    const camera = new Camera(videoElement, {
      onFrame: async () => {
        if (segmentationRef.current) {
          await segmentationRef.current.send({ image: videoElement });
        }
      },
      width: res.width,
      height: res.height
    });

    camera.start();
    cameraRef.current = camera;
    return camera;
  }, []);

  const setBackgroundConfig = useCallback(async (config: BackgroundConfig) => {
    setBackground(config);

    if (config.type === 'image' && config.url) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = config.url;
      await new Promise((resolve) => {
        img.onload = resolve;
      });
      backgroundImageRef.current = img;
    } else if (config.type === 'video' && config.url) {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.src = config.url;
      video.loop = true;
      video.muted = true;
      video.play();
      backgroundVideoRef.current = video;
    }
  }, []);

  const send = useCallback(async (image: HTMLVideoElement | HTMLCanvasElement) => {
    if (!segmentationRef.current) return;

    const browser = detectBrowser();
    const downscaleCanvas = downscaleCanvasRef.current;

    if (browser.isSafari && downscaleCanvas && image instanceof HTMLVideoElement) {
      const ctx = downscaleCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(image, 0, 0, downscaleCanvas.width, downscaleCanvas.height);
        await segmentationRef.current.send({ image: downscaleCanvas });
        return;
      }
    }

    await segmentationRef.current.send({ image });
  }, []);

  useEffect(() => {
    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      if (backgroundVideoRef.current) {
        backgroundVideoRef.current.pause();
      }
    };
  }, []);

  return {
    isReady,
    initialize,
    startCamera,
    send,
    setBackground: setBackgroundConfig,
    outputCanvasRef,
    backgroundCanvasRef
  };
}
