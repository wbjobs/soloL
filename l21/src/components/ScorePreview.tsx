import { useEffect, useRef, useState, useCallback } from 'react';
import * as abcjs from 'abcjs';
import { ZoomIn, ZoomOut, Printer, Download, Music } from 'lucide-react';
import { useCollaborationStore } from '../store/useCollaborationStore';
import { useEditorStore } from '../store/useEditorStore';
import { useMIDIPlayer } from '../hooks/useMIDIPlayer';
import type { Position } from '../../shared/types';
import { cn } from '../lib/utils';

interface ScorePreviewProps {
  className?: string;
  onNoteClick?: (position: Position) => void;
}

export default function ScorePreview({ className, onNoteClick }: ScorePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [highlightedNote, setHighlightedNote] = useState<number | null>(null);

  const { content } = useCollaborationStore();
  const { setPlayPosition, setPlaying } = useEditorStore();

  const { getNoteAtPosition } = useMIDIPlayer({
    abcContent: content,
    onNoteStart: (_note, index) => {
      setHighlightedNote(index);
      setPlayPosition(index);
    },
    onComplete: () => {
      setPlaying(false);
      setHighlightedNote(null);
      setPlayPosition(0);
    },
  });

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = '';

    try {
      const visualObj = abcjs.renderAbc(containerRef.current, content, {
        responsive: 'resize',
        scale: zoom,
        staffwidth: 800,
        paddingtop: 20,
        paddingbottom: 20,
        paddingleft: 40,
        paddingright: 40,
        add_classes: true,
        clickListener: (abcElem) => {
          const elem = abcElem as unknown as { startPos?: { line: number; col: number } };
          if (elem.startPos) {
            const position: Position = {
              line: elem.startPos.line,
              ch: elem.startPos.col,
            };
            onNoteClick?.(position);
            const noteIndex = getNoteAtPosition(position);
            if (noteIndex !== null) {
              setHighlightedNote(noteIndex);
              setPlayPosition(noteIndex);
            }
          }
        },
      } as abcjs.AbcVisualParams);

      svgRef.current = containerRef.current.querySelector('svg');
      if (svgRef.current) {
        svgRef.current.style.width = '100%';
        svgRef.current.style.height = 'auto';
      }

      visualObj.forEach((tune) => {
        const t = tune as unknown as { lines?: Array<{ staves?: Array<{ voices?: Array<Array<{ el?: HTMLElement; startPos?: { line: number; col: number } }>> }> }> };
        t.lines?.forEach((line) => {
          line.staves?.forEach((staff) => {
            staff.voices?.forEach((voice) => {
              voice.forEach((element) => {
                if (element.el && element.startPos) {
                  const position: Position = {
                    line: element.startPos.line,
                    ch: element.startPos.col,
                  };
                  const noteIndex = getNoteAtPosition(position);
                  if (noteIndex !== null) {
                    element.el.dataset.noteIndex = String(noteIndex);
                  }
                }
              });
            });
          });
        });
      });
    } catch (error) {
      console.error('Failed to render ABC:', error);
    }
  }, [content, zoom, onNoteClick, getNoteAtPosition]);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.querySelectorAll('.highlight-note').forEach((el) => {
      el.classList.remove('highlight-note');
    });

    if (highlightedNote !== null) {
      const noteEl = containerRef.current.querySelector(`[data-note-index="${highlightedNote}"]`);
      if (noteEl) {
        noteEl.classList.add('highlight-note');
        const path = noteEl.querySelector('path');
        if (path) {
          path.setAttribute('fill', '#6366f1');
          path.setAttribute('stroke', '#4f46e5');
        }
        noteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightedNote]);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(2, z + 0.1));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(0.5, z - 0.1));
  }, []);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleExportPDF = useCallback(() => {
    if (!svgRef.current) return;

    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      if (ctx) {
        ctx.scale(2, 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, img.width, img.height);
        ctx.drawImage(img, 0, 0);
      }

      const link = document.createElement('a');
      link.download = 'score.pdf';
      link.href = canvas.toDataURL('application/pdf');
      link.click();
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, []);

  return (
    <div className={cn('flex h-full flex-col rounded-lg border border-gray-200 bg-white', className)}>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <div className="flex items-center gap-2">
          <Music className="h-4 w-4 text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">乐谱预览</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="缩小"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs text-gray-500">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="放大"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <div className="mx-2 h-4 w-px bg-gray-200" />
          <button
            onClick={handlePrint}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="打印"
          >
            <Printer className="h-4 w-4" />
          </button>
          <button
            onClick={handleExportPDF}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="导出PDF"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-4 scroll-smooth"
        style={{
          backgroundImage: `
            linear-gradient(to right, #f8fafc 1px, transparent 1px),
            linear-gradient(to bottom, #f8fafc 1px, transparent 1px)
          `,
          backgroundSize: '20px 20px',
        }}
      />
      <style>{`
        .highlight-note path {
          fill: #6366f1 !important;
          stroke: #4f46e5 !important;
          filter: drop-shadow(0 0 4px rgba(99, 102, 241, 0.5));
        }
        .abcjs-note {
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .abcjs-note:hover path {
          fill: #818cf8;
        }
        @media print {
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
