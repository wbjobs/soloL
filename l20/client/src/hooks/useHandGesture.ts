import { useRef, useEffect, useCallback, useState } from 'react';
import { Hands, Results } from '@mediapipe/hands';
import { BackgroundConfig, GestureType, GestureResult } from '../types';
import { createCachedLocateFile } from '../utils/modelCache';

const GESTURE_HOLD_FRAMES = 8;
const GESTURE_COOLDOWN_MS = 2000;

function detectGesture(results: Results): GestureResult {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    return { gesture: 'none', confidence: 0 };
  }

  const landmarks = results.multiHandLandmarks[0];

  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const indexMcp = landmarks[5];
  const middleMcp = landmarks[9];
  const ringMcp = landmarks[13];
  const pinkyMcp = landmarks[17];

  const isFingerExtended = (tip: { y: number }, mcp: { y: number }) => {
    return tip.y < mcp.y;
  };

  const indexExtended = isFingerExtended(indexTip, indexMcp);
  const middleExtended = isFingerExtended(middleTip, middleMcp);
  const ringExtended = isFingerExtended(ringTip, ringMcp);
  const pinkyExtended = isFingerExtended(pinkyTip, pinkyMcp);

  const thumbIndexDist = Math.sqrt(
    Math.pow(thumbTip.x - indexTip.x, 2) +
    Math.pow(thumbTip.y - indexTip.y, 2)
  );

  const isFist = !indexExtended && !middleExtended && !ringExtended && !pinkyExtended;
  const isOk = thumbIndexDist < 0.05 && !ringExtended && !pinkyExtended;
  const isVictory = indexExtended && middleExtended && !ringExtended && !pinkyExtended;

  if (isFist) {
    const fistConf = 1 - (indexMcp.y - indexTip.y + middleMcp.y - middleTip.y) / 2;
    return { gesture: 'fist', confidence: Math.max(0.5, Math.min(1, fistConf * 3)) };
  }

  if (isOk) {
    const okConf = 1 - thumbIndexDist / 0.05;
    return { gesture: 'ok', confidence: Math.max(0.5, Math.min(1, okConf * 2)) };
  }

  if (isVictory) {
    const vicConf = (indexMcp.y - indexTip.y + middleMcp.y - middleTip.y) / 2;
    return { gesture: 'victory', confidence: Math.max(0.5, Math.min(1, vicConf * 5)) };
  }

  return { gesture: 'none', confidence: 0 };
}

const DEFAULT_GESTURE_BG: Record<GestureType, BackgroundConfig> = {
  fist: { type: 'image', url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&h=1080&fit=crop' },
  ok: { type: 'image', url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1920&h=1080&fit=crop' },
  victory: { type: 'blur', blurAmount: 15 },
  none: { type: 'none' }
};

export function useHandGesture(
  setBackground: (config: BackgroundConfig) => void,
  onGestureDetected?: (gesture: GestureType) => void
) {
  const handsRef = useRef<Hands | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [currentGesture, setCurrentGesture] = useState<GestureResult>({ gesture: 'none', confidence: 0 });
  const gestureHoldCountRef = useRef<Map<GestureType, number>>(new Map());
  const lastTriggerTimeRef = useRef<number>(0);
  const gestureMappingRef = useRef<Record<GestureType, BackgroundConfig>>(DEFAULT_GESTURE_BG);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const initialize = useCallback(async () => {
    try {
      offscreenCanvasRef.current = document.createElement('canvas');
      offscreenCanvasRef.current.width = 320;
      offscreenCanvasRef.current.height = 240;

      const hands = new Hands({
        locateFile: createCachedLocateFile(
          'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240'
        )
      });

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5
      });

      hands.onResults((results) => {
        const gesture = detectGesture(results);
        setCurrentGesture(gesture);
        processGestureHold(gesture);
      });

      await hands.initialize();
      handsRef.current = hands;
      setIsReady(true);
    } catch (error) {
      console.error('Failed to initialize hand gesture:', error);
    }
  }, []);

  const processGestureHold = useCallback((result: GestureResult) => {
    if (result.gesture === 'none') {
      gestureHoldCountRef.current.clear();
      return;
    }

    const currentCount = (gestureHoldCountRef.current.get(result.gesture) || 0) + 1;
    gestureHoldCountRef.current.set(result.gesture, currentCount);

    if (currentCount >= GESTURE_HOLD_FRAMES) {
      const now = Date.now();
      if (now - lastTriggerTimeRef.current > GESTURE_COOLDOWN_MS) {
        lastTriggerTimeRef.current = now;
        const bgConfig = gestureMappingRef.current[result.gesture];
        if (bgConfig) {
          setBackground(bgConfig);
          if (onGestureDetected) {
            onGestureDetected(result.gesture);
          }
        }
        gestureHoldCountRef.current.clear();
      }
    }
  }, [setBackground, onGestureDetected]);

  const send = useCallback((video: HTMLVideoElement) => {
    if (!handsRef.current || !offscreenCanvasRef.current) return;

    const canvas = offscreenCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    handsRef.current.send({ image: canvas });
  }, []);

  const updateGestureMapping = useCallback((mapping: Partial<Record<GestureType, BackgroundConfig>>) => {
    gestureMappingRef.current = {
      ...gestureMappingRef.current,
      ...mapping
    };
  }, []);

  useEffect(() => {
    return () => {
      if (handsRef.current) {
        handsRef.current.close();
      }
    };
  }, []);

  return {
    isReady,
    currentGesture,
    initialize,
    send,
    updateGestureMapping
  };
}
