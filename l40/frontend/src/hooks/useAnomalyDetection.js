import { useEffect, useRef, useState, useCallback } from 'react';
import mqtt from 'mqtt';
import {
  initDetector,
  runDetection,
  onAnomaly,
  getAnomalyState,
  getSpectrumData,
  startDetectionLoop,
  stopDetectionLoop,
  feedVibrationSample,
  isDemoModeActive,
} from '../services/anomalyDetector';

const DEFAULT_ANOMALY_STATE = {
  score: 0,
  level: 'normal',
  details: { signals: [], features: {} },
  timestamp: null,
};

export default function useAnomalyDetection(equipmentId) {
  const [anomalyState, setAnomalyState] = useState(DEFAULT_ANOMALY_STATE);
  const [isDetecting, setIsDetecting] = useState(false);
  const [spectrumData, setSpectrumData] = useState(null);
  const [isDemoMode, setIsDemoMode] = useState(true);

  const clientRef = useRef(null);
  const anomalyUnsubscribeRef = useRef(null);
  const spectrumIntervalRef = useRef(null);
  const vibrationBufferRef = useRef([]);

  const updateSpectrum = useCallback(() => {
    if (!equipmentId) return;
    const spectrum = getSpectrumData(equipmentId);
    if (spectrum) {
      setSpectrumData(spectrum);
    }
  }, [equipmentId]);

  const startDetection = useCallback(async () => {
    if (!equipmentId || isDetecting) return;

    await initDetector();
    setIsDemoMode(isDemoModeActive());

    anomalyUnsubscribeRef.current = onAnomaly((event) => {
      if (event.equipmentId === equipmentId) {
        setAnomalyState({
          score: event.score,
          level: event.level,
          details: event.details,
          timestamp: event.timestamp,
        });
      }
    });

    startDetectionLoop(equipmentId);

    spectrumIntervalRef.current = setInterval(updateSpectrum, 1000);

    setIsDetecting(true);
  }, [equipmentId, isDetecting, updateSpectrum]);

  const stopDetection = useCallback(() => {
    if (!equipmentId) return;

    stopDetectionLoop(equipmentId);

    if (anomalyUnsubscribeRef.current) {
      anomalyUnsubscribeRef.current();
      anomalyUnsubscribeRef.current = null;
    }

    if (spectrumIntervalRef.current) {
      clearInterval(spectrumIntervalRef.current);
      spectrumIntervalRef.current = null;
    }

    setIsDetecting(false);
    setAnomalyState(DEFAULT_ANOMALY_STATE);
    setSpectrumData(null);
  }, [equipmentId]);

  useEffect(() => {
    if (!equipmentId) return;

    const topic = `sensor/${equipmentId}/vibration`;

    const connect = () => {
      const client = mqtt.connect('ws://localhost:9001', {
        clientId: `anomaly_${Math.random().toString(16).slice(2, 10)}`,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
      });

      clientRef.current = client;

      client.on('connect', () => {
        console.log('[AnomalyMQTT] Connected');
        client.subscribe(topic, { qos: 1 }, (err) => {
          if (err) console.error('[AnomalyMQTT] Subscribe error', err);
        });
      });

      client.on('message', (receivedTopic, payload) => {
        try {
          const raw = payload.toString();
          let value;
          try {
            const parsed = JSON.parse(raw);
            value = parseFloat(parsed.value);
          } catch {
            value = parseFloat(raw);
          }
          if (isNaN(value)) return;

          feedVibrationSample(equipmentId, value);

          vibrationBufferRef.current.push(value);
          if (vibrationBufferRef.current.length >= 64) {
            const batch = vibrationBufferRef.current.slice(-256);
            vibrationBufferRef.current = [];
            runDetection(batch, equipmentId).then((result) => {
              if (result) {
                setAnomalyState({
                  score: result.anomalyScore,
                  level: result.anomalyLevel,
                  details: result.details || { signals: [], features: {} },
                  timestamp: result.timestamp,
                });
              }
            });
          }
        } catch (e) {
          console.error('[AnomalyMQTT] Parse error', e);
        }
      });

      client.on('error', (err) => {
        console.error('[AnomalyMQTT] Error', err);
      });

      client.on('close', () => {
        console.log('[AnomalyMQTT] Connection closed');
      });
    };

    connect();

    return () => {
      if (clientRef.current) {
        clientRef.current.unsubscribe(topic);
        clientRef.current.end(true);
        clientRef.current = null;
      }
    };
  }, [equipmentId]);

  useEffect(() => {
    return () => {
      stopDetection();
      vibrationBufferRef.current = [];
    };
  }, [stopDetection]);

  return {
    anomalyState,
    isDetecting,
    isDemoMode,
    startDetection,
    stopDetection,
    spectrumData,
  };
}
