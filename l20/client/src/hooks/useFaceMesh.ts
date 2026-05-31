import { useRef, useEffect, useCallback, useState } from 'react';
import { FaceMesh, Results } from '@mediapipe/face_mesh';
import { BlendShapes } from '../types';
import { createCachedLocateFile } from '../utils/modelCache';

const BLENDSHAPE_NAMES = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawRight',
  'jawOpen', 'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthLeft',
  'mouthRight', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft',
  'mouthFrownRight', 'mouthDimpleLeft', 'mouthDimpleRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthRollLower',
  'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthPressLeft', 'mouthPressRight', 'mouthLowerDownLeft',
  'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'browDownLeft', 'browDownRight', 'browInnerUp',
  'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff',
  'cheekSquintLeft', 'cheekSquintRight', 'noseSneerLeft',
  'noseSneerRight', 'tongueOut', 'headRoll', 'leftEyeRoll',
  'rightEyeRoll', 'headYaw', 'headPitch', 'mouthX', 'mouthY',
  'mouthScale', 'mouthAngle'
];

interface UseFaceMeshOptions {
  onBlendShapes?: (blendShapes: BlendShapes) => void;
}

export function useFaceMesh(options: UseFaceMeshOptions = {}) {
  const faceMeshRef = useRef<FaceMesh | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [blendShapes, setBlendShapes] = useState<BlendShapes>({});
  const lastResultsRef = useRef<Results | null>(null);

  const calculateBlendShapes = useCallback((results: Results): BlendShapes => {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      return {};
    }

    const landmarks = results.multiFaceLandmarks[0];
    const shapes: BlendShapes = {};

    const getDistance = (i1: number, i2: number) => {
      const p1 = landmarks[i1];
      const p2 = landmarks[i2];
      return Math.sqrt(
        Math.pow(p1.x - p2.x, 2) +
        Math.pow(p1.y - p2.y, 2) +
        Math.pow(p1.z - p2.z, 2)
      );
    };

    const normalizeValue = (value: number, min: number, max: number) => {
      return Math.max(0, Math.min(1, (value - min) / (max - min)));
    };

    const normalizeWithCurve = (value: number, min: number, max: number, power: number) => {
      const linear = Math.max(0, Math.min(1, (value - min) / (max - min)));
      return Math.pow(linear, power);
    };

    const eyeLeftOpen = getDistance(159, 145);
    const eyeRightOpen = getDistance(386, 374);
    const eyeBaseLeft = getDistance(33, 133);
    const eyeBaseRight = getDistance(362, 263);

    shapes['eyeBlinkLeft'] = 1 - normalizeValue(eyeLeftOpen / eyeBaseLeft, 0.1, 0.35);
    shapes['eyeBlinkRight'] = 1 - normalizeValue(eyeRightOpen / eyeBaseRight, 0.1, 0.35);
    shapes['eyeWideLeft'] = normalizeValue(eyeLeftOpen / eyeBaseLeft, 0.25, 0.45);
    shapes['eyeWideRight'] = normalizeValue(eyeRightOpen / eyeBaseRight, 0.25, 0.45);

    const jawUpper = landmarks[13];
    const jawLower = landmarks[14];
    const jawDistance2D = Math.abs(jawUpper.y - jawLower.y);
    const faceHeight = getDistance(10, 152);
    const jawOpenRatio = jawDistance2D / (faceHeight || 1);
    shapes['jawOpen'] = normalizeWithCurve(jawOpenRatio, 0.005, 0.18, 0.7);

    const mouthUpper = landmarks[13];
    const mouthLower = landmarks[14];
    const mouthLeft = landmarks[61];
    const mouthRight = landmarks[291];

    const mouthHeight = Math.abs(mouthUpper.y - mouthLower.y);
    const mouthWidth = Math.abs(mouthRight.x - mouthLeft.x);
    const mouthHeightRatio = mouthHeight / (faceHeight || 1);

    shapes['mouthClose'] = 1 - normalizeWithCurve(mouthHeightRatio, 0.005, 0.15, 0.8);
    shapes['mouthFunnel'] = normalizeWithCurve(mouthHeight / (mouthWidth || 1), 0.15, 0.8, 0.7);
    shapes['mouthPucker'] = normalizeValue(1 / (mouthWidth || 1), 5, 15);

    const mouthCornerLeft = landmarks[48];
    const mouthCornerRight = landmarks[278];
    const lipBottom = landmarks[17];
    const lipTop = landmarks[0];

    const smileLeft = (lipBottom.y - mouthCornerLeft.y) / (lipBottom.y - lipTop.y || 1);
    const smileRight = (lipBottom.y - mouthCornerRight.y) / (lipBottom.y - lipTop.y || 1);

    shapes['mouthSmileLeft'] = normalizeValue(smileLeft, 0.3, 0.8);
    shapes['mouthSmileRight'] = normalizeValue(smileRight, 0.3, 0.8);
    shapes['mouthFrownLeft'] = Math.max(0, normalizeValue(-smileLeft, -0.5, 0.2));
    shapes['mouthFrownRight'] = Math.max(0, normalizeValue(-smileRight, -0.5, 0.2));

    const browInnerLeft = landmarks[70];
    const browInnerRight = landmarks[300];
    const browOuterLeft = landmarks[105];
    const browOuterRight = landmarks[334];
    const eyeInnerLeft = landmarks[133];
    const eyeInnerRight = landmarks[362];

    shapes['browInnerUp'] = normalizeValue(
      ((eyeInnerLeft.y - browInnerLeft.y) + (eyeInnerRight.y - browInnerRight.y)) / 2,
      0.05, 0.15
    );

    shapes['browOuterUpLeft'] = normalizeValue(eyeInnerLeft.y - browOuterLeft.y, 0.08, 0.18);
    shapes['browOuterUpRight'] = normalizeValue(eyeInnerRight.y - browOuterRight.y, 0.08, 0.18);

    const noseTip = landmarks[1];
    const noseLeft = landmarks[115];
    const noseRight = landmarks[344];

    shapes['noseSneerLeft'] = normalizeValue(noseTip.y - noseLeft.y, 0.01, 0.05);
    shapes['noseSneerRight'] = normalizeValue(noseTip.y - noseRight.y, 0.01, 0.05);

    const cheekLeft = landmarks[234];
    const cheekRight = landmarks[454];
    const cheekBoneLeft = landmarks[117];
    const cheekBoneRight = landmarks[346];

    shapes['cheekPuff'] = normalizeValue(
      (getDistance(234, 454) - getDistance(117, 346)) / getDistance(117, 346),
      0, 0.3
    );

    const headTop = landmarks[10];
    const headBottom = landmarks[152];
    const headLeft = landmarks[234];
    const headRight = landmarks[454];

    shapes['headYaw'] = Math.max(-1, Math.min(1, (headRight.x - headLeft.x) / (headBottom.y - headTop.y) - 1));
    shapes['headPitch'] = Math.max(-1, Math.min(1, (noseTip.y - headTop.y) / (headBottom.y - headTop.y) - 0.5));

    BLENDSHAPE_NAMES.forEach(name => {
      if (shapes[name] === undefined) {
        shapes[name] = 0;
      }
      shapes[name] = Math.round(shapes[name] * 1000) / 1000;
    });

    return shapes;
  }, []);

  const initialize = useCallback(async () => {
    const faceMesh = new FaceMesh({
      locateFile: createCachedLocateFile(
        'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619'
      )
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    faceMesh.onResults((results) => {
      lastResultsRef.current = results;
      const shapes = calculateBlendShapes(results);
      setBlendShapes(shapes);
      if (options.onBlendShapes) {
        options.onBlendShapes(shapes);
      }
    });

    await faceMesh.initialize();
    faceMeshRef.current = faceMesh;
    setIsReady(true);

    return faceMesh;
  }, [options, calculateBlendShapes]);

  const send = useCallback(async (image: HTMLVideoElement | HTMLCanvasElement) => {
    if (faceMeshRef.current) {
      await faceMeshRef.current.send({ image });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (faceMeshRef.current) {
        faceMeshRef.current.close();
      }
    };
  }, []);

  return {
    isReady,
    initialize,
    send,
    blendShapes,
    lastResults: lastResultsRef.current
  };
}
