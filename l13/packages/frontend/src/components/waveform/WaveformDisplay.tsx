import React, { useEffect, useRef, memo, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import type { ProofreadBlock } from '../../types';
import { usePlayerStore } from '../../stores/player-store';
import { updateBlock } from '../../api/proofread';

interface WaveformDisplayProps {
  src: string;
  blocks: ProofreadBlock[];
  onSeek: (time: number) => void;
  onBlockTimeUpdate?: (blockId: string, startTime: number, endTime: number) => void;
}

interface RegionElement {
  container: HTMLDivElement;
  leftHandle: HTMLDivElement;
  rightHandle: HTMLDivElement;
  mouseMoveHandler: ((e: MouseEvent) => void) | null;
  mouseUpHandler: ((e: MouseEvent) => void) | null;
}

export const WaveformDisplay: React.FC<WaveformDisplayProps> = memo(
  ({ src, blocks, onSeek, onBlockTimeUpdate }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const regionsRef = useRef<Map<string, RegionElement>>(new Map());
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const rafIdRef = useRef<number | null>(null);
    const currentTime = usePlayerStore((s) => s.currentTime);
    const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cleanupRegions = useCallback(() => {
      regionsRef.current.forEach((region) => {
        if (region.mouseMoveHandler) {
          document.removeEventListener('mousemove', region.mouseMoveHandler);
        }
        if (region.mouseUpHandler) {
          document.removeEventListener('mouseup', region.mouseUpHandler);
        }
        region.leftHandle.remove();
        region.rightHandle.remove();
        region.container.remove();
      });
      regionsRef.current.clear();
    }, []);

    const destroyWaveSurfer = useCallback(() => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      if (resizeTimeoutRef.current !== null) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }

      cleanupRegions();

      if (wavesurferRef.current) {
        try {
          wavesurferRef.current.unAll();
          wavesurferRef.current.destroy();
        } catch (e) {
          console.warn('WaveSurfer destroy error:', e);
        }
        wavesurferRef.current = null;
      }

      const canvas = containerRef.current?.querySelector('canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        canvas.width = 0;
        canvas.height = 0;
      }
    }, [cleanupRegions]);

    useEffect(() => {
      if (!containerRef.current) return;

      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#4a90d9',
        progressColor: '#1a5fb4',
        cursorColor: '#ff4444',
        cursorWidth: 2,
        height: 80,
        barWidth: 2,
        barGap: 1,
        barRadius: 1,
        normalize: true,
        backend: 'WebAudio',
        url: src,
      });

      wavesurferRef.current = ws;

      ws.on('click', (relativeX) => {
        const duration = ws.getDuration();
        const time = relativeX * duration;
        onSeek(time);
      });

      ws.on('ready', () => {
        const duration = ws.getDuration();
        usePlayerStore.getState().setDuration(duration);
      });

      ws.on('error', (err) => {
        console.error('WaveSurfer error:', err);
      });

      const handleResize = () => {
        if (!ws || !ws.getDuration()) return;

        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }

        resizeTimeoutRef.current = setTimeout(() => {
          try {
            const canvas = containerRef.current?.querySelector('canvas');
            if (canvas) {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
              }
            }

            cleanupRegions();
            ws.empty();
            ws.load(src);
          } catch (e) {
            console.warn('WaveSurfer resize error:', e);
          }
        }, 100);
      };

      resizeObserverRef.current = new ResizeObserver(handleResize);
      resizeObserverRef.current.observe(containerRef.current);

      return () => {
        if (resizeObserverRef.current) {
          resizeObserverRef.current.disconnect();
          resizeObserverRef.current = null;
        }
        destroyWaveSurfer();
      };
    }, [src, onSeek, cleanupRegions, destroyWaveSurfer]);

    useEffect(() => {
      const ws = wavesurferRef.current;
      if (!ws || !ws.getDuration()) return;

      const duration = ws.getDuration();
      const progress = duration > 0 ? currentTime / duration : 0;

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        try {
          ws.seekTo(progress);
        } catch (e) {
          console.warn('WaveSurfer seek error:', e);
        }
        rafIdRef.current = null;
      });
    }, [currentTime]);

    useEffect(() => {
      const ws = wavesurferRef.current;
      if (!ws || !ws.getDuration()) return;

      const duration = ws.getDuration();

      cleanupRegions();

      const waveContainer = containerRef.current?.querySelector('div');
      if (!waveContainer) return;

      waveContainer.style.position = 'relative';

      blocks.forEach((block) => {
        const start = duration > 0 ? block.startTime / duration : 0;
        const end = duration > 0 ? block.endTime / duration : 0;

        const regionEl = document.createElement('div');
        regionEl.className = 'waveform-region';
        regionEl.style.position = 'absolute';
        regionEl.style.left = `${start * 100}%`;
        regionEl.style.width = `${(end - start) * 100}%`;
        regionEl.style.top = '0';
        regionEl.style.height = '100%';
        regionEl.style.backgroundColor = 'rgba(74, 144, 217, 0.2)';
        regionEl.style.borderLeft = '2px solid rgba(74, 144, 217, 0.6)';
        regionEl.style.borderRight = '2px solid rgba(74, 144, 217, 0.6)';
        regionEl.style.pointerEvents = 'auto';
        regionEl.style.cursor = 'pointer';
        regionEl.style.zIndex = '3';

        regionEl.addEventListener('click', (e) => {
          e.stopPropagation();
          onSeek(block.startTime);
        });

        const leftHandle = document.createElement('div');
        leftHandle.className = 'region-handle region-handle-left';
        leftHandle.style.cssText = `
          position: absolute; left: -4px; top: 0; width: 8px; height: 100%;
          cursor: ew-resize; z-index: 4;
        `;

        const rightHandle = document.createElement('div');
        rightHandle.className = 'region-handle region-handle-right';
        rightHandle.style.cssText = `
          position: absolute; right: -4px; top: 0; width: 8px; height: 100%;
          cursor: ew-resize; z-index: 4;
        `;

        let isDragging = false;
        let dragSide: 'left' | 'right' | null = null;
        let startX = 0;
        let currentBlock = { ...block };
        let mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
        let mouseUpHandler: ((e: MouseEvent) => void) | null = null;

        const onMouseDown = (e: MouseEvent, side: 'left' | 'right') => {
          e.stopPropagation();
          e.preventDefault();
          isDragging = true;
          dragSide = side;
          startX = e.clientX;
          currentBlock = { ...block };

          mouseMoveHandler = (moveEvent: MouseEvent) => {
            if (!isDragging || !dragSide) return;
            const container = containerRef.current;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const dx = moveEvent.clientX - startX;
            const dxRatio = dx / rect.width;
            const dxTime = dxRatio * duration;

            let newStart = currentBlock.startTime;
            let newEnd = currentBlock.endTime;

            if (dragSide === 'left') {
              newStart = Math.max(0, Math.min(newStart + dxTime, newEnd - 0.1));
            } else {
              newEnd = Math.max(newStart + 0.1, Math.min(newEnd + dxTime, duration));
            }

            const newStartRatio = newStart / duration;
            const newEndRatio = newEnd / duration;
            regionEl.style.left = `${newStartRatio * 100}%`;
            regionEl.style.width = `${(newEndRatio - newStartRatio) * 100}%`;

            startX = moveEvent.clientX;
            currentBlock.startTime = newStart;
            currentBlock.endTime = newEnd;

            onBlockTimeUpdate?.(block.id, newStart, newEnd);
          };

          mouseUpHandler = () => {
            isDragging = false;
            dragSide = null;

            if (mouseMoveHandler) {
              document.removeEventListener('mousemove', mouseMoveHandler);
              mouseMoveHandler = null;
            }
            if (mouseUpHandler) {
              document.removeEventListener('mouseup', mouseUpHandler);
              mouseUpHandler = null;
            }

            updateBlock({
              blockId: block.id,
              startTime: currentBlock.startTime,
              endTime: currentBlock.endTime,
            }).catch(console.error);
          };

          document.addEventListener('mousemove', mouseMoveHandler);
          document.addEventListener('mouseup', mouseUpHandler);
        };

        const leftMouseDownHandler = (e: Event) => onMouseDown(e as MouseEvent, 'left');
        const rightMouseDownHandler = (e: Event) => onMouseDown(e as MouseEvent, 'right');

        leftHandle.addEventListener('mousedown', leftMouseDownHandler);
        rightHandle.addEventListener('mousedown', rightMouseDownHandler);

        regionEl.appendChild(leftHandle);
        regionEl.appendChild(rightHandle);
        waveContainer.appendChild(regionEl);

        regionsRef.current.set(block.id, {
          container: regionEl,
          leftHandle,
          rightHandle,
          mouseMoveHandler: null,
          mouseUpHandler: null,
        });
      });
    }, [blocks, onSeek, onBlockTimeUpdate, cleanupRegions]);

    return (
      <div className="waveform-display">
        <div ref={containerRef} className="waveform-container" />
      </div>
    );
  },
);

WaveformDisplay.displayName = 'WaveformDisplay';
