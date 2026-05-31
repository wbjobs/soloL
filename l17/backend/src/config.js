const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
let envVars = {};

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      envVars[match[1].trim()] = match[2].trim();
    }
  });
}

const getEnv = (key, defaultValue) => {
  return process.env[key] || envVars[key] || defaultValue;
};

module.exports = {
  udp: {
    port: parseInt(getEnv('UDP_PORT', '8000')),
    host: getEnv('UDP_HOST', '0.0.0.0')
  },
  http: {
    port: parseInt(getEnv('HTTP_PORT', '3001'))
  },
  websocket: {
    port: parseInt(getEnv('WS_PORT', '8080'))
  },
  influxdb: {
    url: getEnv('INFLUXDB_URL', 'http://localhost:8086'),
    token: getEnv('INFLUXDB_TOKEN', 'eyetracker-token'),
    org: getEnv('INFLUXDB_ORG', 'eyetracker'),
    bucket: getEnv('INFLUXDB_BUCKET', 'eyetracker')
  },
  processing: {
    pupilMinDiameter: parseFloat(getEnv('PUPIL_MIN_DIAMETER', '0.2')),
    aggregationRate: parseInt(getEnv('AGGREGATION_RATE', '10')),
    aggregationIntervalMs: parseInt(getEnv('AGGREGATION_INTERVAL_MS', '100'))
  },
  screen: {
    width: 1920,
    height: 1080
  }
};
