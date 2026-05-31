import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { File, Track } from 'jsmidgen';
import { renderAbc } from 'abcjs';
import { parseABCNotes, NoteInfo } from './chordAI.js';

export interface ExportOptions {
  title?: string;
  composer?: string;
  includeHeader?: boolean;
  includeFooter?: boolean;
  pageSize?: 'a4' | 'letter';
}

export interface MidiExportOptions {
  tempo?: number;
  transpose?: number;
  velocity?: number;
  program?: number;
}

function parseABCHeader(abcContent: string): Record<string, string> {
  const header: Record<string, string> = {};
  const lines = abcContent.split('\n');

  for (const line of lines) {
    const match = line.match(/^([A-Z]):\s*(.*)$/);
    if (match) {
      header[match[1]] = match[2].trim();
    }
  }

  return header;
}

export async function exportToPDF(
  abcContent: string,
  options: ExportOptions = {}
): Promise<Blob> {
  const {
    title,
    composer,
    includeHeader = true,
    includeFooter = true,
    pageSize = 'a4',
  } = options;

  const header = parseABCHeader(abcContent);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: pageSize,
  });

  const pageWidth = pageSize === 'a4' ? 210 : 216;
  const pageHeight = pageSize === 'a4' ? 297 : 279;
  const margin = 20;
  let yPosition = margin;

  doc.setFont('helvetica');
  doc.setFontSize(10);

  if (includeHeader) {
    const docTitle = title || header.T || 'Untitled Score';
    const docComposer = composer || header.C || '';

    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(docTitle, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 10;

    if (docComposer) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(docComposer, pageWidth / 2, yPosition, { align: 'center' });
      doc.setTextColor(0, 0, 0);
      yPosition += 8;
    }

    yPosition += 10;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 10;
  }

  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  container.style.width = `${pageWidth - margin * 2}mm`;
  document.body.appendChild(container);

  try {
    renderAbc(container, abcContent, {
      responsive: 'resize',
      staffwidth: (pageWidth - margin * 2) * 3.78,
      paddingtop: 0,
      paddingbottom: 0,
      paddingleft: 0,
      paddingright: 0,
      add_classes: true,
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const svgElement = container.querySelector('svg');
    if (svgElement) {
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });

      const imgWidth = pageWidth - margin * 2;
      const imgHeight = (img.height * imgWidth) / img.width;

      if (yPosition + imgHeight > pageHeight - margin) {
        doc.addPage();
        yPosition = margin;
      }

      doc.addImage(
        img,
        'SVG',
        margin,
        yPosition,
        imgWidth,
        imgHeight
      );

      yPosition += imgHeight + 10;
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.warn('SVG rendering failed, falling back to text export:', error);

    doc.setFontSize(10);
    doc.setFont('courier');

    const lines = abcContent.split('\n');
    for (const line of lines) {
      if (yPosition > pageHeight - margin - 10) {
        doc.addPage();
        yPosition = margin;
      }
      doc.text(line, margin, yPosition);
      yPosition += 5;
    }
  } finally {
    document.body.removeChild(container);
  }

  if (includeFooter) {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `Page ${i} of ${pageCount}`,
        pageWidth / 2,
        pageHeight - 10,
        { align: 'center' }
      );
      doc.setTextColor(0, 0, 0);
    }
  }

  return doc.output('blob');
}

function noteToMidiNumber(note: NoteInfo, transpose: number = 0): number {
  return Math.max(0, Math.min(127, note.midiNumber + transpose));
}

export function exportToMIDI(
  abcContent: string,
  options: MidiExportOptions = {}
): Blob {
  const {
    tempo = 120,
    transpose = 0,
    velocity = 80,
    program = 0,
  } = options;

  const notes = parseABCNotes(abcContent, 0, abcContent.split('\n').length - 1);
  const midi = new File({ ticks: 128 });
  const track = new Track();

  track.setTempo(tempo);
  track.setInstrument(0, (program & 0xFF) as any);

  const ticksPerBeat = 128;
  let currentTick = 0;

  notes.forEach(note => {
    const midiNote = noteToMidiNumber(note, transpose);
    const durationTicks = Math.round(note.duration * ticksPerBeat);

    track.noteOn(0, midiNote, currentTick, velocity & 0xFF);
    track.noteOff(0, midiNote, currentTick + durationTicks, velocity & 0xFF);

    currentTick += durationTicks;
  });

  midi.addTrack(track);

  const midiBytes = midi.toBytes();
  const buffer = new Uint8Array(midiBytes.length);
  for (let i = 0; i < midiBytes.length; i++) {
    buffer[i] = midiBytes[i] & 0xFF;
  }

  return new Blob([buffer], { type: 'audio/midi' });
}

export function exportToABC(abcContent: string): Blob {
  return new Blob([abcContent], { type: 'text/plain;charset=utf-8' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function getSuggestedFilename(abcContent: string, extension: string): string {
  const header = parseABCHeader(abcContent);
  const title = header.T || 'score';
  const sanitized = title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  return `${sanitized}.${extension}`;
}

export async function exportScore(
  format: 'pdf' | 'midi' | 'abc',
  abcContent: string,
  options?: ExportOptions & MidiExportOptions
): Promise<void> {
  let blob: Blob;
  let filename: string;

  switch (format) {
    case 'pdf':
      blob = await exportToPDF(abcContent, options);
      filename = getSuggestedFilename(abcContent, 'pdf');
      break;
    case 'midi':
      blob = exportToMIDI(abcContent, options);
      filename = getSuggestedFilename(abcContent, 'mid');
      break;
    case 'abc':
      blob = exportToABC(abcContent);
      filename = getSuggestedFilename(abcContent, 'abc');
      break;
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }

  downloadBlob(blob, filename);
}

export interface ExportInfo {
  format: 'pdf' | 'midi' | 'abc';
  label: string;
  icon: string;
  description: string;
}

export const EXPORT_FORMATS: ExportInfo[] = [
  {
    format: 'pdf',
    label: 'PDF文档',
    icon: 'file-text',
    description: '适合打印和分享的乐谱',
  },
  {
    format: 'midi',
    label: 'MIDI音频',
    icon: 'music',
    description: '可在DAW中编辑的音频文件',
  },
  {
    format: 'abc',
    label: 'ABC源代码',
    icon: 'code',
    description: '原始ABC记谱法文本',
  },
];
