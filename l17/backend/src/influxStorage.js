const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const EventEmitter = require('events');
const config = require('./config');

class InfluxStorage extends EventEmitter {
  constructor() {
    super();
    this.influxDB = new InfluxDB({
      url: config.influxdb.url,
      token: config.influxdb.token
    });
    this.writeApi = this.influxDB.getWriteApi(
      config.influxdb.org,
      config.influxdb.bucket,
      'ms'
    );
    this.queryApi = this.influxDB.getQueryApi(config.influxdb.org);
    this.bucket = config.influxdb.bucket;
    this.org = config.influxdb.org;
    this.writeBuffer = [];
    this.flushInterval = null;
    this.flushIntervalMs = 100;
    this.maxBufferSize = 1000;
    this.connected = false;
  }

  async connect() {
    try {
      const query = `from(bucket: "${this.bucket}") |> range(start: -1m) |> limit(n:1)`;
      await this.queryApi.collectRows(query);
      this.connected = true;
      console.log('InfluxDB connected successfully');
      this.startAutoFlush();
      return true;
    } catch (err) {
      console.warn('InfluxDB connection check failed:', err.message);
      console.log('Continuing without InfluxDB - data will not be persisted');
      this.connected = false;
      return false;
    }
  }

  startAutoFlush() {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  writePoint(dataPoint) {
    if (!this.connected) return;

    const point = new Point('eyetracking')
      .floatField('x', dataPoint.x)
      .floatField('y', dataPoint.y)
      .floatField('pupil_diameter', dataPoint.pupilDiameter)
      .timestamp(dataPoint.timestamp);

    this.writeBuffer.push(point);

    if (this.writeBuffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  writeBatch(dataPoints) {
    if (!this.connected) return;

    dataPoints.forEach(point => this.writePoint(point));
  }

  flush() {
    if (this.writeBuffer.length === 0 || !this.connected) return;

    try {
      this.writeApi.writePoints(this.writeBuffer);
      this.emit('flushed', this.writeBuffer.length);
      this.writeBuffer = [];
    } catch (err) {
      console.error('Error writing to InfluxDB:', err.message);
    }
  }

  async queryRange(startTime, endTime) {
    if (!this.connected) {
      return [];
    }

    const start = new Date(startTime).toISOString();
    const end = new Date(endTime).toISOString();

    const fluxQuery = `
      from(bucket: "${this.bucket}")
        |> range(start: ${start}, stop: ${end})
        |> filter(fn: (r) => r._measurement == "eyetracking")
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> keep(columns: ["_time", "x", "y", "pupil_diameter"])
        |> sort(columns: ["_time"])
    `;

    try {
      const rows = await this.queryApi.collectRows(fluxQuery);
      return rows.map(row => ({
        x: row.x,
        y: row.y,
        pupilDiameter: row.pupil_diameter,
        timestamp: new Date(row._time).getTime()
      }));
    } catch (err) {
      console.error('Error querying InfluxDB:', err.message);
      return [];
    }
  }

  async queryLast(durationMs) {
    if (!this.connected) {
      return [];
    }

    const fluxQuery = `
      from(bucket: "${this.bucket}")
        |> range(start: -${durationMs}ms)
        |> filter(fn: (r) => r._measurement == "eyetracking")
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> keep(columns: ["_time", "x", "y", "pupil_diameter"])
        |> sort(columns: ["_time"])
    `;

    try {
      const rows = await this.queryApi.collectRows(fluxQuery);
      return rows.map(row => ({
        x: row.x,
        y: row.y,
        pupilDiameter: row.pupil_diameter,
        timestamp: new Date(row._time).getTime()
      }));
    } catch (err) {
      console.error('Error querying InfluxDB:', err.message);
      return [];
    }
  }

  async close() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
    if (this.connected) {
      await this.writeApi.close();
      console.log('InfluxDB connection closed');
    }
  }
}

module.exports = InfluxStorage;
