import { SEGYHeader, SEGYTrace, Point3D } from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';

const SEGY_HEADER_SIZE = 3200;
const BINARY_HEADER_SIZE = 400;
const TRACE_HEADER_SIZE = 240;

export function parseSEGYFile(filePath: string): { header: SEGYHeader; traces: SEGYTrace[] } {
  try {
    const buffer = fs.readFileSync(filePath);
    
    const binaryHeaderOffset = SEGY_HEADER_SIZE;
    const sampleInterval = buffer.readUInt32BE(binaryHeaderOffset + 16);
    const sampleCount = buffer.readUInt16BE(binaryHeaderOffset + 20);
    const formatCode = buffer.readUInt16BE(binaryHeaderOffset + 24);
    const traceCount = Math.floor((buffer.length - SEGY_HEADER_SIZE - BINARY_HEADER_SIZE) / 
                              (TRACE_HEADER_SIZE + sampleCount * 4));
    
    const header: SEGYHeader = {
      sampleInterval: sampleInterval / 1000,
      sampleCount,
      traceCount,
      formatCode
    };
    
    const traces: SEGYTrace[] = [];
    let offset = SEGY_HEADER_SIZE + BINARY_HEADER_SIZE;
    
    for (let i = 0; i < traceCount; i++) {
      const traceHeader = parseTraceHeader(buffer, offset);
      offset += TRACE_HEADER_SIZE;
      
      const data: number[] = [];
      for (let j = 0; j < sampleCount; j++) {
        data.push(buffer.readFloatBE(offset + j * 4));
      }
      offset += sampleCount * 4;
      
      traces.push({
        header: traceHeader,
        data
      });
    }
    
    return { header, traces };
  } catch (error) {
    console.error('Error parsing SEGY file:', error);
    throw error;
  }
}

function parseTraceHeader(buffer: Buffer, offset: number): Record<string, number> {
  return {
    traceSequence: buffer.readInt32BE(offset),
    fieldRecord: buffer.readInt32BE(offset + 4),
    traceNumber: buffer.readInt32BE(offset + 8),
    energySourcePoint: buffer.readInt32BE(offset + 12),
    cdpNumber: buffer.readInt32BE(offset + 20),
    cdpTrace: buffer.readInt32BE(offset + 24),
    traceIdentification: buffer.readInt16BE(offset + 28),
    sourceX: buffer.readInt32BE(offset + 72),
    sourceY: buffer.readInt32BE(offset + 76),
    groupX: buffer.readInt32BE(offset + 80),
    groupY: buffer.readInt32BE(offset + 84),
    coordinateUnit: buffer.readInt16BE(offset + 88),
    sampleCount: buffer.readInt16BE(offset + 114),
    sampleInterval: buffer.readInt16BE(offset + 116)
  };
}

export function extractControlPoints(traces: SEGYTrace[]): Point3D[] {
  const points: Point3D[] = [];
  
  for (const trace of traces) {
    const x = trace.header.sourceX || trace.header.groupX || 0;
    const y = trace.header.sourceY || trace.header.groupY || 0;
    
    for (let i = 0; i < trace.data.length; i += 10) {
      const z = i * 0.1;
      const value = trace.data[i];
      points.push({ x, y, z });
    }
  }
  
  return points;
}

export function generateMockSEGYData(): { header: SEGYHeader; traces: SEGYTrace[] } {
  const traceCount = 50;
  const sampleCount = 200;
  
  const header: SEGYHeader = {
    sampleInterval: 0.004,
    sampleCount,
    traceCount,
    formatCode: 5
  };
  
  const traces: SEGYTrace[] = [];
  const gridSize = Math.ceil(Math.sqrt(traceCount));
  
  for (let i = 0; i < traceCount; i++) {
    const gridX = (i % gridSize) - gridSize / 2;
    const gridY = Math.floor(i / gridSize) - gridSize / 2;
    
    const traceHeader: Record<string, number> = {
      traceSequence: i + 1,
      sourceX: gridX * 100,
      sourceY: gridY * 100,
      groupX: gridX * 100,
      groupY: gridY * 100,
      sampleCount,
      sampleInterval: 4000
    };
    
    const data: number[] = [];
    for (let j = 0; j < sampleCount; j++) {
      const depth = j * 0.05;
      const noise = (Math.random() - 0.5) * 0.2;
      
      let value = 0;
      if (depth < 1) {
        value = Math.sin(depth * 10) * Math.exp(-depth) + noise;
      } else if (depth < 3) {
        value = Math.sin(depth * 8 + 1) * Math.exp(-depth * 0.8) * 0.8 + noise;
      } else if (depth < 5) {
        value = Math.sin(depth * 6 + 2) * Math.exp(-depth * 0.6) * 0.6 + noise;
      } else if (depth < 8) {
        value = Math.sin(depth * 12 + 3) * Math.exp(-depth * 0.5) * 0.5 + noise;
      } else {
        value = Math.sin(depth * 4) * Math.exp(-depth * 0.4) * 0.3 + noise;
      }
      
      data.push(value);
    }
    
    traces.push({ header: traceHeader, data });
  }
  
  return { header, traces };
}

export function extractDataPoints(traces: SEGYTrace[]): { points: Point3D[]; values: number[] } {
  const points: Point3D[] = [];
  const values: number[] = [];
  
  for (const trace of traces) {
    const x = trace.header.sourceX || trace.header.groupX || 0;
    const y = trace.header.sourceY || trace.header.groupY || 0;
    
    for (let i = 0; i < trace.data.length; i += 5) {
      const z = i * 0.05;
      points.push({ x, y, z });
      values.push(trace.data[i]);
    }
  }
  
  return { points, values };
}

export function getSEGYPreview(traces: SEGYTrace[]): number[][] {
  const preview: number[][] = [];
  const step = Math.max(1, Math.floor(traces.length / 20));
  
  for (let i = 0; i < traces.length; i += step) {
    const trace = traces[i];
    const tracePreview: number[] = [];
    const dataStep = Math.max(1, Math.floor(trace.data.length / 100));
    
    for (let j = 0; j < trace.data.length; j += dataStep) {
      tracePreview.push(trace.data[j]);
    }
    preview.push(tracePreview);
  }
  
  return preview;
}

export function saveSEGYMeta(fileId: string, filename: string, header: SEGYHeader, dataDir: string): void {
  const metaPath = path.join(dataDir, 'segy', `${fileId}_meta.json`);
  const meta = {
    id: fileId,
    filename,
    header,
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

export function loadSEGYMeta(fileId: string, dataDir: string): any {
  const metaPath = path.join(dataDir, 'segy', `${fileId}_meta.json`);
  if (fs.existsSync(metaPath)) {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }
  return null;
}
