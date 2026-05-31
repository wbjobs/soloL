import { useRef, useEffect, useCallback } from 'react';

interface UseCameraOptions {
  width?: number;
  height?: number;
  fps?: number;
}

export function useCamera(options: UseCameraOptions = {}) {
  const { width = 1920, height = 1080, fps = 30 } = options;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: fps }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      return stream;
    } catch (error) {
      console.error('Failed to start camera:', error);
      throw error;
    }
  }, [width, height, fps]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  return { videoRef, startCamera, stopCamera, streamRef };
}
