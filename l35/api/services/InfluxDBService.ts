import { InfluxDB, Point, WriteApi, QueryApi } from '@influxdata/influxdb-client';

interface Detection {
  bbox: [number, number, number, number];
  confidence: number;
  classId: number;
  label: string;
}

interface DetectionRegionResult {
  regionId: string;
  insideCount: number;
  breached: boolean;
}

interface DetectionReport {
  sourceId: string;
  timestamp: string | number | Date;
  detections: Detection[];
  count: number;
  regions: DetectionRegionResult[];
}

interface HeatmapData {
  sourceId: string;
  timeRange: { start: string; end: string };
  grid: number[][];
  maxDensity: number;
}

class InfluxDBService {
  private client: InfluxDB | null = null;
  private writeApi: WriteApi | null = null;
  private queryApi: QueryApi | null = null;
  private url = 'http://localhost:8086';
  private token = 'edge-token';
  private org = 'edge-org';
  private bucket = 'detections';
  private initialized = false;

  init(): void {
    this.url = process.env.INFLUXDB_URL || this.url;
    this.token = process.env.INFLUXDB_TOKEN || this.token;
    this.org = process.env.INFLUXDB_ORG || this.org;
    this.bucket = process.env.INFLUXDB_BUCKET || this.bucket;

    this.client = new InfluxDB({ url: this.url, token: this.token });
    this.writeApi = this.client.getWriteApi(this.org, this.bucket);
    this.writeApi.useDefaultTags({ app: 'edge-detection' });
    this.queryApi = this.client.getQueryApi(this.org);
    this.initialized = true;

    console.log(`InfluxDB initialized: ${this.url}, org: ${this.org}, bucket: ${this.bucket}`);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.init();
    }
  }

  async close(): Promise<void> {
    if (this.writeApi) {
      try {
        await this.writeApi.close();
      } catch (err) {
        console.error('Error closing InfluxDB:', err);
      }
    }
    this.client = null;
    this.writeApi = null;
    this.queryApi = null;
    this.initialized = false;
  }

  async writeDetection(report: DetectionReport): Promise<void> {
    this.ensureInitialized();
    if (!this.writeApi) throw new Error('InfluxDB not initialized');

    const ts = new Date(report.timestamp).getTime() * 1e6;

    this.writeApi.writePoint(
      new Point('detection')
        .tag('sourceId', report.sourceId)
        .intField('count', report.count)
        .intField('detectionCount', report.detections.length)
        .timestamp(ts)
    );

    for (const region of report.regions) {
      this.writeApi.writePoint(
        new Point('detection')
          .tag('sourceId', report.sourceId)
          .tag('regionId', region.regionId)
          .intField('count', report.count)
          .intField('detectionCount', report.detections.length)
          .intField('insideCount', region.insideCount)
          .booleanField('breached', region.breached)
          .timestamp(ts)
      );
    }

    for (const det of report.detections) {
      const [x, y, w, h] = det.bbox;
      this.writeApi.writePoint(
        new Point('detection')
          .tag('sourceId', report.sourceId)
          .floatField('x', x + w / 2)
          .floatField('y', y + h / 2)
          .floatField('w', w)
          .floatField('h', h)
          .floatField('confidence', det.confidence)
          .intField('classId', det.classId)
          .timestamp(ts)
      );
    }

    try {
      await this.flush();
    } catch (err) {
      console.error('InfluxDB flush error (bucket may not exist):', err);
    }
  }

  async queryHeatmap(
    sourceId: string,
    start: Date,
    end: Date,
    resolution: number = 20
  ): Promise<HeatmapData> {
    this.ensureInitialized();
    if (!this.queryApi) throw new Error('InfluxDB not initialized');

    const startISO = start.toISOString();
    const endISO = end.toISOString();
    const resFloat = resolution.toFixed(1);

    const fluxQuery = `
      from(bucket: "${this.bucket}")
        |> range(start: ${startISO}, stop: ${endISO})
        |> filter(fn: (r) => r._measurement == "detection" and r.sourceId == "${sourceId}")
        |> filter(fn: (r) => r._field == "x" or r._field == "y")
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> map(fn: (r) => ({
          r with
          gx: int(v: math.floor(x: r.x * ${resFloat})),
          gy: int(v: math.floor(x: r.y * ${resFloat}))
        }))
        |> filter(fn: (r) => r.gx >= 0 and r.gx < ${resolution} and r.gy >= 0 and r.gy < ${resolution})
        |> group(columns: ["gx", "gy"])
        |> count()
        |> keep(columns: ["gx", "gy", "_value"])
    `;

    const grid: number[][] = Array(resolution).fill(null).map(() => Array(resolution).fill(0));
    let maxDensity = 0;

    try {
      for await (const { values, tableMeta } of this.queryApi.iterateRows(fluxQuery)) {
        const o = tableMeta.toObject(values) as any;
        const x = Math.min(Math.max(o.gx || 0, 0), resolution - 1);
        const y = Math.min(Math.max(o.gy || 0, 0), resolution - 1);
        const count = o._value || 0;
        grid[y][x] += count;
        if (grid[y][x] > maxDensity) maxDensity = grid[y][x];
      }
    } catch (err) {
      console.error('Error querying heatmap:', err);
    }

    return { sourceId, timeRange: { start: startISO, end: endISO }, grid, maxDensity };
  }

  async queryCountTrend(
    sourceId: string,
    start: Date,
    end: Date,
    interval: string = '1h'
  ): Promise<Array<{ time: Date; count: number }>> {
    this.ensureInitialized();
    if (!this.queryApi) throw new Error('InfluxDB not initialized');

    const startISO = start.toISOString();
    const endISO = end.toISOString();

    const fluxQuery = `
      from(bucket: "${this.bucket}")
        |> range(start: ${startISO}, stop: ${endISO})
        |> filter(fn: (r) => r._measurement == "detection" and r.sourceId == "${sourceId}")
        |> filter(fn: (r) => not exists r.regionId and r._field == "count")
        |> aggregateWindow(every: ${interval}, fn: max, createEmpty: true)
        |> keep(columns: ["_time", "_value"])
    `;

    const result: Array<{ time: Date; count: number }> = [];

    try {
      for await (const { values, tableMeta } of this.queryApi.iterateRows(fluxQuery)) {
        const o = tableMeta.toObject(values) as any;
        result.push({ time: new Date(o._time), count: o._value || 0 });
      }
    } catch (err) {
      console.error('Error querying count trend:', err);
    }

    return result;
  }

  writePoint(point: Point): void {
    this.ensureInitialized();
    if (!this.writeApi) throw new Error('InfluxDB not initialized');
    this.writeApi.writePoint(point);
  }

  async flush(): Promise<void> {
    if (this.writeApi) await this.writeApi.flush();
  }
}

const influxDB = new InfluxDBService();

export default InfluxDBService;
export { influxDB };
