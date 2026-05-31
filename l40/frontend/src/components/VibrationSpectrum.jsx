import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Card, Button, Space, Tooltip, Segmented } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  ExpandOutlined,
  CompressOutlined,
} from '@ant-design/icons';

const COLOR_STOPS = [
  { pos: 0, r: 0, g: 0, b: 139 },
  { pos: 0.2, r: 0, g: 100, b: 255 },
  { pos: 0.4, r: 0, g: 200, b: 100 },
  { pos: 0.6, r: 255, g: 255, b: 0 },
  { pos: 0.8, r: 255, g: 140, b: 0 },
  { pos: 1.0, r: 255, g: 0, b: 0 },
];

function magnitudeToColor(value, maxVal) {
  if (maxVal === 0) return { r: 0, g: 0, b: 0 };
  const t = Math.min(1, Math.max(0, value / maxVal));

  let lower = COLOR_STOPS[0];
  let upper = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (t >= COLOR_STOPS[i].pos && t <= COLOR_STOPS[i + 1].pos) {
      lower = COLOR_STOPS[i];
      upper = COLOR_STOPS[i + 1];
      break;
    }
  }

  const range = upper.pos - lower.pos;
  const f = range === 0 ? 0 : (t - lower.pos) / range;

  return {
    r: Math.round(lower.r + (upper.r - lower.r) * f),
    g: Math.round(lower.g + (upper.g - lower.g) * f),
    b: Math.round(lower.b + (upper.b - lower.b) * f),
  };
}

function drawSpectrum(ctx, width, height, magnitude, frequencies, peaks, anomalyThreshold, zoomRange) {
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, width, height);

  const padding = { top: 20, right: 10, bottom: 30, left: 50 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const maxFreq = frequencies?.[frequencies.length - 1] || 500;
  const minFreq = zoomRange ? zoomRange[0] : 0;
  const maxFreqView = zoomRange ? zoomRange[1] : maxFreq;

  if (!magnitude || magnitude.length === 0) {
    ctx.fillStyle = '#5a7a9a';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No spectrum data', width / 2, height / 2);
    return;
  }

  const maxMag = Math.max(...magnitude) || 1;

  const startBin = frequencies
    ? frequencies.findIndex((f) => f >= minFreq)
    : 0;
  const endBin = frequencies
    ? frequencies.findIndex((f) => f >= maxFreqView)
    : magnitude.length;
  const effectiveStart = Math.max(0, startBin);
  const effectiveEnd = endBin < 0 ? magnitude.length : endBin;
  const binCount = effectiveEnd - effectiveStart;

  ctx.strokeStyle = 'rgba(54, 207, 201, 0.1)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (plotH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotW, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 5; i++) {
    const x = padding.left + (plotW / 5) * i;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + plotH);
    ctx.stroke();
  }

  if (anomalyThreshold != null) {
    const threshY = padding.top + plotH * (1 - anomalyThreshold / maxMag);
    if (threshY >= padding.top && threshY <= padding.top + plotH) {
      ctx.strokeStyle = '#ff4d4f80';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, threshY);
      ctx.lineTo(padding.left + plotW, threshY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#ff4d4f';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('Threshold', padding.left + 4, threshY - 3);
    }
  }

  const barWidth = Math.max(1, plotW / binCount);
  for (let i = 0; i < binCount; i++) {
    const binIdx = effectiveStart + i;
    const val = magnitude[binIdx] || 0;
    const barH = (val / maxMag) * plotH;
    const x = padding.left + (i / binCount) * plotW;
    const y = padding.top + plotH - barH;

    const color = magnitudeToColor(val, maxMag);
    ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
    ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), barH);
  }

  if (peaks && peaks.length > 0) {
    for (const peak of peaks) {
      const binIdx = Math.round(peak.bin || 0);
      if (binIdx < effectiveStart || binIdx > effectiveEnd) continue;

      const x = padding.left + ((binIdx - effectiveStart) / binCount) * plotW;
      const y = padding.top + plotH - (peak.magnitude / maxMag) * plotH;

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x, y - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 5);
      ctx.lineTo(x, y - 2);
      ctx.lineTo(x + 3, y - 5);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      const freqLabel = (peak.freq || 0).toFixed(0) + 'Hz';
      ctx.fillText(freqLabel, x, y - 10);
    }
  }

  ctx.fillStyle = '#5a7a9a';
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 5; i++) {
    const x = padding.left + (plotW / 5) * i;
    const freq = minFreq + ((maxFreqView - minFreq) / 5) * i;
    ctx.fillText(freq.toFixed(0) + 'Hz', x, padding.top + plotH + 16);
  }

  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (plotH / 5) * i;
    const val = maxMag * (1 - i / 5);
    ctx.fillText(val.toFixed(2), padding.left - 4, y + 3);
  }
}

function drawWaterfall(ctx, width, height, history, frequencies, zoomRange) {
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, width, height);

  if (!history || history.length === 0) {
    ctx.fillStyle = '#5a7a9a';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No waterfall data', width / 2, height / 2);
    return;
  }

  const padding = { top: 10, right: 10, bottom: 30, left: 50 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const maxFreq = frequencies?.[frequencies.length - 1] || 500;
  const minFreq = zoomRange ? zoomRange[0] : 0;
  const maxFreqView = zoomRange ? zoomRange[1] : maxFreq;

  const startBin = frequencies ? frequencies.findIndex((f) => f >= minFreq) : 0;
  const endBin = frequencies ? frequencies.findIndex((f) => f >= maxFreqView) : -1;
  const effectiveStart = Math.max(0, startBin);
  const effectiveEnd = endBin < 0 ? (frequencies?.length || 100) : endBin;
  const binCount = effectiveEnd - effectiveStart;

  const globalMax = history.reduce((max, frame) => {
    const frameMax = Math.max(...frame.magnitude.slice(effectiveStart, effectiveEnd));
    return Math.max(max, frameMax);
  }, 0) || 1;

  const rowHeight = Math.max(1, plotH / 60);
  const visibleFrames = Math.min(history.length, Math.floor(plotH / rowHeight));

  for (let f = 0; f < visibleFrames; f++) {
    const frame = history[history.length - visibleFrames + f];
    const y = padding.top + f * rowHeight;

    for (let b = 0; b < binCount; b++) {
      const binIdx = effectiveStart + b;
      const val = frame.magnitude[binIdx] || 0;
      const color = magnitudeToColor(val, globalMax);
      const x = padding.left + (b / binCount) * plotW;
      const colW = Math.max(1, plotW / binCount);

      ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      ctx.fillRect(x, y, colW + 0.5, rowHeight + 0.5);
    }
  }

  ctx.fillStyle = '#5a7a9a';
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 5; i++) {
    const x = padding.left + (plotW / 5) * i;
    const freq = minFreq + ((maxFreqView - minFreq) / 5) * i;
    ctx.fillText(freq.toFixed(0) + 'Hz', x, height - 8);
  }

  ctx.textAlign = 'right';
  ctx.fillText('Now', padding.left - 4, padding.top + 4);
  ctx.fillText(`${(visibleFrames * 2)}s`, padding.left - 4, padding.top + visibleFrames * rowHeight);
}

function VibrationSpectrum({
  spectrumData,
  anomalyThreshold,
  compact = false,
  height = compact ? 200 : 320,
  onSpectrumClick,
}) {
  const canvasRef = useRef(null);
  const [mode, setMode] = useState('spectrum');
  const [isPaused, setIsPaused] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const waterfallHistoryRef = useRef([]);
  const frameCountRef = useRef(0);

  const zoomRange = isZoomed ? [0, 200] : null;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }

    const w = rect.width;
    const h = rect.height;

    if (!spectrumData || isPaused) {
      if (mode === 'spectrum') {
        const lastMag = waterfallHistoryRef.current.length > 0
          ? waterfallHistoryRef.current[waterfallHistoryRef.current.length - 1].magnitude
          : null;
        drawSpectrum(
          ctx, w, h, lastMag, spectrumData?.frequencies,
          spectrumData?.peaks, anomalyThreshold, zoomRange
        );
      } else {
        drawWaterfall(ctx, w, h, waterfallHistoryRef.current, spectrumData?.frequencies, zoomRange);
      }
      return;
    }

    if (mode === 'spectrum') {
      const peaks = spectrumData.magnitude
        ? (() => {
            const pks = [];
            for (let i = 1; i < spectrumData.magnitude.length - 1; i++) {
              if (
                spectrumData.magnitude[i] > spectrumData.magnitude[i - 1] &&
                spectrumData.magnitude[i] > spectrumData.magnitude[i + 1]
              ) {
                pks.push({
                  bin: i,
                  magnitude: spectrumData.magnitude[i],
                  freq: spectrumData.frequencies?.[i] || 0,
                });
              }
            }
            pks.sort((a, b) => b.magnitude - a.magnitude);
            return pks.slice(0, 5);
          })()
        : [];

      drawSpectrum(
        ctx, w, h, spectrumData.magnitude, spectrumData.frequencies,
        peaks, anomalyThreshold, zoomRange
      );
    } else {
      drawWaterfall(ctx, w, h, waterfallHistoryRef.current, spectrumData.frequencies, zoomRange);
    }
  }, [spectrumData, mode, isPaused, anomalyThreshold, zoomRange]);

  useEffect(() => {
    if (spectrumData && !isPaused && spectrumData.magnitude) {
      frameCountRef.current++;
      if (frameCountRef.current % 4 === 0) {
        waterfallHistoryRef.current.push({
          magnitude: Float64Array.from(spectrumData.magnitude),
        });
        if (waterfallHistoryRef.current.length > 60) {
          waterfallHistoryRef.current.shift();
        }
      }
    }
  }, [spectrumData, isPaused]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    if (isPaused) return;

    let rafId;
    const loop = () => {
      draw();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [draw, isPaused]);

  const handleCanvasClick = useCallback((e) => {
    if (onSpectrumClick) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const freqIdx = Math.floor(
          (x / rect.width) * (spectrumData?.frequencies?.length || 0)
        );
        onSpectrumClick({
          frequency: spectrumData?.frequencies?.[freqIdx],
          magnitude: spectrumData?.magnitude?.[freqIdx],
        });
      }
    }
  }, [spectrumData, onSpectrumClick]);

  return (
    <Card
      size="small"
      className="glass-card"
      bodyStyle={{ padding: compact ? '8px' : '12px' }}
      title={compact ? null : (
        <span style={{ fontSize: 12, color: '#36cfc9', fontFamily: "'JetBrains Mono', monospace" }}>
          Vibration Spectrum
        </span>
      )}
      extra={compact ? null : (
        <Space size={4}>
          <Segmented
            size="small"
            value={mode}
            onChange={setMode}
            options={[
              { label: 'Spectrum', value: 'spectrum' },
              { label: 'Waterfall', value: 'waterfall' },
            ]}
            style={{ background: 'rgba(54, 207, 201, 0.1)' }}
          />
          <Tooltip title={isPaused ? 'Resume' : 'Pause'}>
            <Button
              type="text"
              size="small"
              icon={isPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
              onClick={() => setIsPaused(!isPaused)}
              style={{ color: '#36cfc9' }}
            />
          </Tooltip>
          <Tooltip title={isZoomed ? 'Zoom Out' : 'Zoom In (0-200Hz)'}>
            <Button
              type="text"
              size="small"
              icon={isZoomed ? <CompressOutlined /> : <ExpandOutlined />}
              onClick={() => setIsZoomed(!isZoomed)}
              style={{ color: '#36cfc9' }}
            />
          </Tooltip>
        </Space>
      )}
    >
      {compact && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4, gap: 4 }}>
          <Button
            type="text"
            size="small"
            icon={isPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
            onClick={() => setIsPaused(!isPaused)}
            style={{ color: '#36cfc9', fontSize: 10 }}
          />
          <Button
            type="text"
            size="small"
            icon={isZoomed ? <CompressOutlined /> : <ExpandOutlined />}
            onClick={() => setIsZoomed(!isZoomed)}
            style={{ color: '#36cfc9', fontSize: 10 }}
          />
          <Segmented
            size="small"
            value={mode}
            onChange={setMode}
            options={[
              { label: 'FFT', value: 'spectrum' },
              { label: 'WF', value: 'waterfall' },
            ]}
            style={{ background: 'rgba(54, 207, 201, 0.1)', fontSize: 10 }}
          />
        </div>
      )}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{
          width: '100%',
          height,
          display: 'block',
          borderRadius: 4,
          cursor: onSpectrumClick ? 'crosshair' : 'default',
        }}
      />
    </Card>
  );
}

export default React.memo(VibrationSpectrum);
