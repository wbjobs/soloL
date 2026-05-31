import mqtt from 'mqtt';
import dotenv from 'dotenv';
import { query } from './db/init.js';

dotenv.config();

const BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const CLIENT_ID = process.env.MQTT_CLIENT_ID || 'mr-inspection-backend';

const latestSensorData = new Map();

let client = null;

export function startMqtt() {
  client = mqtt.connect(BROKER, {
    clientId: CLIENT_ID,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
  });

  client.on('connect', () => {
    console.log('Connected to MQTT broker:', BROKER);

    client.subscribe('sensor/+/temperature', { qos: 1 }, (err) => {
      if (err) console.error('Subscribe error (temperature):', err.message);
    });
    client.subscribe('sensor/+/vibration', { qos: 1 }, (err) => {
      if (err) console.error('Subscribe error (vibration):', err.message);
    });
    client.subscribe('sensor/+/rpm', { qos: 1 }, (err) => {
      if (err) console.error('Subscribe error (rpm):', err.message);
    });
  });

  client.on('message', async (topic, message) => {
    try {
      const parts = topic.split('/');
      if (parts.length !== 3) return;

      const equipmentId = parseInt(parts[1]);
      const sensorType = parts[2];
      const payload = JSON.parse(message.toString());
      const value = parseFloat(payload.value);
      const unit = payload.unit || '';

      if (isNaN(equipmentId) || isNaN(value)) return;

      await query(
        'INSERT INTO sensor_data (equipment_id, sensor_type, value, unit, timestamp) VALUES ($1, $2, $3, $4, NOW())',
        [equipmentId, sensorType, value, unit]
      );

      const cacheKey = `${equipmentId}`;
      if (!latestSensorData.has(cacheKey)) {
        latestSensorData.set(cacheKey, {});
      }
      latestSensorData.get(cacheKey)[sensorType] = {
        value,
        unit,
        timestamp: new Date().toISOString(),
      };

      console.log(`Sensor data stored: equipment=${equipmentId} type=${sensorType} value=${value}`);
    } catch (err) {
      console.error('Error processing MQTT message:', err.message);
    }
  });

  client.on('error', (err) => {
    console.error('MQTT client error:', err.message);
  });

  client.on('reconnect', () => {
    console.log('MQTT client reconnecting...');
  });

  client.on('close', () => {
    console.log('MQTT client disconnected');
  });

  client.on('offline', () => {
    console.log('MQTT client offline');
  });
}

export function publish(topic, message) {
  if (!client || !client.connected) {
    console.error('MQTT client not connected, cannot publish');
    return;
  }
  const payload = typeof message === 'string' ? message : JSON.stringify(message);
  client.publish(topic, payload, { qos: 1 });
}

export function getLatestSensorData(equipmentId) {
  return latestSensorData.get(String(equipmentId)) || null;
}

export function getMqttClient() {
  return client;
}
