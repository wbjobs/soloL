import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  ShadingType,
} from 'docx';
import { query } from '../db/init.js';

const SEVERITY_COLORS = {
  low: '22C55E',
  medium: 'F59E0B',
  high: 'EF4444',
  critical: 'DC2626',
};

async function generateInspectionReport(inspectionId) {
  const inspectionResult = await query('SELECT * FROM inspections WHERE id = $1', [inspectionId]);
  if (inspectionResult.rows.length === 0) {
    throw new Error('Inspection not found');
  }
  const inspection = inspectionResult.rows[0];

  const equipmentResult = await query('SELECT * FROM equipment WHERE id = $1', [inspection.equipment_id]);
  const equipment = equipmentResult.rows[0];

  const defectsResult = await query('SELECT * FROM defects WHERE inspection_id = $1 ORDER BY created_at', [inspectionId]);
  const defects = defectsResult.rows;

  const sensorResult = await query(
    'SELECT DISTINCT ON (sensor_type) sensor_type, value, unit, timestamp FROM sensor_data WHERE equipment_id = $1 ORDER BY sensor_type, timestamp DESC',
    [inspection.equipment_id]
  );
  const sensorData = sensorResult.rows;

  const defectRows = defects.map((d, i) =>
    new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun(String(i + 1))] })],
          width: { size: 5, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: d.severity.toUpperCase(), color: SEVERITY_COLORS[d.severity] || '000000', bold: true })],
          })],
          width: { size: 12, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun(d.description || 'No description')],
          })],
          width: { size: 43, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun(`(${d.position?.x ?? 0}, ${d.position?.y ?? 0}, ${d.position?.z ?? 0})`)],
          })],
          width: { size: 20, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun(d.photo_url ? 'Yes' : 'No')],
          })],
          width: { size: 10, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun(d.voice_url ? 'Yes' : 'No')],
          })],
          width: { size: 10, type: WidthType.PERCENTAGE },
        }),
      ],
    })
  );

  const sensorRows = sensorData.map((s) =>
    new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun(s.sensor_type)] })],
          width: { size: 33, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun(`${s.value} ${s.unit || ''}`)] })],
          width: { size: 33, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun(new Date(s.timestamp).toLocaleString())] })],
          width: { size: 34, type: WidthType.PERCENTAGE },
        }),
      ],
    })
  );

  const criticalCount = defects.filter((d) => d.severity === 'critical').length;
  const highCount = defects.filter((d) => d.severity === 'high').length;
  const mediumCount = defects.filter((d) => d.severity === 'medium').length;
  const lowCount = defects.filter((d) => d.severity === 'low').length;

  let conclusion = 'Equipment appears to be in satisfactory condition.';
  if (criticalCount > 0) {
    conclusion = 'URGENT: Critical defects detected. Immediate action required before equipment can continue operation.';
  } else if (highCount > 0) {
    conclusion = 'High-severity defects detected. Equipment requires prompt attention and repair.';
  } else if (mediumCount > 0) {
    conclusion = 'Medium-severity defects detected. Schedule maintenance at the earliest convenience.';
  } else if (lowCount > 0) {
    conclusion = 'Minor defects detected. Monitor during next scheduled maintenance window.';
  }

  const specs = equipment.specs || {};
  const specEntries = Object.entries(specs);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({ text: 'INDUSTRIAL EQUIPMENT INSPECTION REPORT', bold: true, size: 32, font: 'Calibri' }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({ text: 'MR Inspection System', size: 20, color: '666666', font: 'Calibri' }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: '1F4E79' } },
            children: [],
          }),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 200 },
            children: [new TextRun({ text: 'Inspection Information', bold: true, size: 24, color: '1F4E79' })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              createInfoRow('Report ID', `INS-${String(inspection.id).padStart(5, '0')}`),
              createInfoRow('Date', new Date(inspection.created_at).toLocaleDateString()),
              createInfoRow('Inspector', inspection.inspector),
              createInfoRow('Status', inspection.status.toUpperCase()),
            ],
          }),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 400, after: 200 },
            children: [new TextRun({ text: 'Equipment Details', bold: true, size: 24, color: '1F4E79' })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              createInfoRow('Equipment Name', equipment.name),
              createInfoRow('QR Code', equipment.qr_code),
              createInfoRow('Location', equipment.location || 'N/A'),
              createInfoRow('3D Model', equipment.model_path || 'N/A'),
              ...specEntries.map(([key, val]) => createInfoRow(key, String(val))),
            ],
          }),

          ...(sensorData.length > 0 ? [
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 400, after: 200 },
              children: [new TextRun({ text: 'Latest Sensor Readings', bold: true, size: 24, color: '1F4E79' })],
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  tableHeader: true,
                  children: [
                    createHeaderCell('Sensor Type', 33),
                    createHeaderCell('Value', 33),
                    createHeaderCell('Last Updated', 34),
                  ],
                }),
                ...sensorRows,
              ],
            }),
          ] : []),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 400, after: 200 },
            children: [new TextRun({ text: `Defects (${defects.length} found)`, bold: true, size: 24, color: '1F4E79' })],
          }),
          ...(defects.length > 0 ? [
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  tableHeader: true,
                  children: [
                    createHeaderCell('#', 5),
                    createHeaderCell('Severity', 12),
                    createHeaderCell('Description', 43),
                    createHeaderCell('Position (x,y,z)', 20),
                    createHeaderCell('Photo', 10),
                    createHeaderCell('Voice', 10),
                  ],
                }),
                ...defectRows,
              ],
            }),
          ] : [
            new Paragraph({
              spacing: { after: 200 },
              children: [new TextRun({ text: 'No defects recorded during this inspection.', italics: true, color: '666666' })],
            }),
          ]),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 400, after: 200 },
            children: [new TextRun({ text: 'Defect Summary', bold: true, size: 24, color: '1F4E79' })],
          }),
          new Table({
            width: { size: 50, type: WidthType.PERCENTAGE },
            rows: [
              createInfoRow('Critical', String(criticalCount)),
              createInfoRow('High', String(highCount)),
              createInfoRow('Medium', String(mediumCount)),
              createInfoRow('Low', String(lowCount)),
              createInfoRow('Total', String(defects.length)),
            ],
          }),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 400, after: 200 },
            children: [new TextRun({ text: 'Conclusion', bold: true, size: 24, color: '1F4E79' })],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: conclusion, size: 22 })],
          }),

          ...(inspection.notes ? [
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 400, after: 200 },
              children: [new TextRun({ text: 'Inspector Notes', bold: true, size: 24, color: '1F4E79' })],
            }),
            new Paragraph({
              spacing: { after: 200 },
              children: [new TextRun({ text: inspection.notes, size: 22 })],
            }),
          ] : []),

          new Paragraph({
            spacing: { before: 600 },
            border: { top: { style: BorderStyle.SINGLE, size: 3, color: '1F4E79' } },
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Generated by MR Inspection System', size: 16, color: '999999', italics: true }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: `Report generated on ${new Date().toLocaleString()}`, size: 16, color: '999999', italics: true }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

function createInfoRow(label, value) {
  return new TableRow({
    children: [
      new TableCell({
        shading: { type: ShadingType.SOLID, color: 'E8EEF4' },
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })] })],
      }),
      new TableCell({
        width: { size: 70, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: value, size: 20 })] })],
      }),
    ],
  });
}

function createHeaderCell(text, widthPercent) {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: '1F4E79' },
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 18, font: 'Calibri' })],
    })],
  });
}

export { generateInspectionReport };
