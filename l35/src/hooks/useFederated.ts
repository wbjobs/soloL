import { useState, useRef, useCallback, useEffect } from "react";
import type { AnnotationDetection, ActionType } from "@/types";

const GRADIENT_CLIP_NORM = 1.0;
const NOISE_SCALE = 0.01;
const UPDATE_CHECK_INTERVAL = 60000;

interface GradientData {
  modelVersion: string;
  clientId: string;
  gradients: number[][];
  metadata: {
    sampleCount: number;
    timestamp: number;
  };
}

function computePseudoGradients(
  modelOutput: AnnotationDetection[],
  groundTruth: AnnotationDetection[]
): number[][] {
  const gradients: number[][] = [];
  const numSamples = Math.max(modelOutput.length, groundTruth.length);

  for (let i = 0; i < numSamples; i++) {
    const model = modelOutput[i];
    const truth = groundTruth[i];

    const grad: number[] = new Array(10).fill(0);

    if (model && truth) {
      for (let j = 0; j < 4; j++) {
        grad[j] = (model.bbox[j] - truth.bbox[j]) * 2;
      }
      grad[4] = model.confidence - (truth.isCorrection ? 1.0 : 0.5);

      const actionDiff = computeActionDifference(model.actionLabel, truth.actionLabel);
      grad[5] = actionDiff;
    } else if (model) {
      grad[4] = model.confidence - 0;
    } else if (truth) {
      for (let j = 0; j < 4; j++) {
        grad[j] = 0 - truth.bbox[j];
      }
      grad[4] = 0 - 1.0;
    }

    gradients.push(grad);
  }

  return gradients;
}

function computeActionDifference(
  modelAction?: ActionType,
  truthAction?: ActionType
): number {
  const actionOrder: Record<ActionType, number> = {
    normal: 0,
    fall: 1,
    chasing: 2,
    running: 3,
    loitering: 4,
  };

  const model = modelAction ? actionOrder[modelAction] : 0;
  const truth = truthAction ? actionOrder[truthAction] : 0;
  return (model - truth) / 4;
}

function clipGradients(gradients: number[][], maxNorm: number): number[][] {
  let totalNorm = 0;

  for (const grad of gradients) {
    for (const val of grad) {
      totalNorm += val * val;
    }
  }

  totalNorm = Math.sqrt(totalNorm);

  if (totalNorm <= maxNorm) return gradients;

  const scale = maxNorm / totalNorm;
  return gradients.map((grad) => grad.map((val) => val * scale));
}

function addGaussianNoise(gradients: number[][], scale: number): number[][] {
  return gradients.map((grad) =>
    grad.map((val) => val + scale * (Math.random() * 2 - 1))
  );
}

export function useFederated() {
  const [modelVersion, setModelVersion] = useState<string>("1.0.0");
  const [isUploading, setIsUploading] = useState(false);

  const clientIdRef = useRef<string>(
    `client-${Math.random().toString(36).substr(2, 9)}`
  );

  const uploadGradients = useCallback(
    async (
      sourceId: string,
      modelDetections: AnnotationDetection[],
      correctedDetections: AnnotationDetection[]
    ): Promise<boolean> => {
      if (isUploading) return false;
      setIsUploading(true);

      try {
        const rawGradients = computePseudoGradients(
          modelDetections,
          correctedDetections
        );
        const clippedGradients = clipGradients(rawGradients, GRADIENT_CLIP_NORM);
        const noisyGradients = addGaussianNoise(clippedGradients, NOISE_SCALE);

        const payload: GradientData = {
          modelVersion,
          clientId: clientIdRef.current,
          gradients: noisyGradients,
          metadata: {
            sampleCount: correctedDetections.length,
            timestamp: Date.now(),
          },
        };

        const res = await fetch("/api/federated/gradients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId, ...payload }),
        });

        if (!res.ok) throw new Error("Upload failed");

        const data = await res.json();
        if (data.newVersion) {
          setModelVersion(data.newVersion);
        }

        return true;
      } catch {
        return false;
      } finally {
        setIsUploading(false);
      }
    },
    [isUploading, modelVersion]
  );

  const checkForUpdates = useCallback(async () => {
    try {
      const res = await fetch("/api/federated/version");
      if (!res.ok) return;

      const data = await res.json();
      if (data.version && data.version !== modelVersion) {
        setModelVersion(data.version);
      }
    } catch {
      void 0;
    }
  }, [modelVersion]);

  useEffect(() => {
    const interval = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [checkForUpdates]);

  return {
    uploadGradients,
    modelVersion,
    isUploading,
  };
}
