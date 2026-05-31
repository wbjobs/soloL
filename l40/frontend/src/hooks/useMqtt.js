import { useEffect, useRef, useState } from 'react';
import mqtt from 'mqtt';

export default function useMqtt(equipmentId) {
  const [latestValues, setLatestValues] = useState({
    temperature: null,
    vibration: null,
    rpm: null,
  });
  const clientRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  useEffect(() => {
    if (!equipmentId) return;

    const topics = [
      `sensor/${equipmentId}/temperature`,
      `sensor/${equipmentId}/vibration`,
      `sensor/${equipmentId}/rpm`,
    ];

    const connect = () => {
      const client = mqtt.connect('ws://localhost:9001', {
        clientId: `insp_${Math.random().toString(16).slice(2, 10)}`,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
      });

      clientRef.current = client;

      client.on('connect', () => {
        console.log('[MQTT] Connected');
        client.subscribe(topics, { qos: 1 }, (err) => {
          if (err) console.error('[MQTT] Subscribe error', err);
        });
      });

      client.on('message', (topic, payload) => {
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

          if (topic.includes('/temperature')) {
            setLatestValues((prev) => ({ ...prev, temperature: value }));
          } else if (topic.includes('/vibration')) {
            setLatestValues((prev) => ({ ...prev, vibration: value }));
          } else if (topic.includes('/rpm')) {
            setLatestValues((prev) => ({ ...prev, rpm: value }));
          }
        } catch (e) {
          console.error('[MQTT] Parse error', e);
        }
      });

      client.on('error', (err) => {
        console.error('[MQTT] Error', err);
      });

      client.on('close', () => {
        console.log('[MQTT] Connection closed');
      });

      client.on('reconnect', () => {
        console.log('[MQTT] Reconnecting...');
      });
    };

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (clientRef.current) {
        clientRef.current.unsubscribe(topics);
        clientRef.current.end(true);
        clientRef.current = null;
      }
    };
  }, [equipmentId]);

  return latestValues;
}
