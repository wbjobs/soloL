import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { parseSEGYFile, generateMockSEGYData, getSEGYPreview, saveSEGYMeta, loadSEGYMeta } from '../utils/segyParser';
import { extractDataPoints } from '../utils/segyParser';

const router = Router();

const dataDir = path.join(process.cwd(), 'data');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const segyDir = path.join(dataDir, 'segy');
    if (!fs.existsSync(segyDir)) {
      fs.mkdirSync(segyDir, { recursive: true });
    }
    cb(null, segyDir);
  },
  filename: (req, file, cb) => {
    const fileId = uuidv4();
    cb(null, `${fileId}.segy`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.segy') || file.originalname.endsWith('.sgy')) {
      cb(null, true);
    } else {
      cb(new Error('Only SEGY files are allowed'));
    }
  }
});

router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileId = req.file.filename.replace('.segy', '');
    const filePath = req.file.path;

    const { header, traces } = parseSEGYFile(filePath);
    const preview = getSEGYPreview(traces);

    saveSEGYMeta(fileId, req.file.originalname, header, dataDir);

    res.json({
      fileId,
      header,
      preview,
      traceCount: traces.length
    });
  } catch (error: any) {
    console.error('SEGY upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/mock', (req: Request, res: Response) => {
  try {
    const { header, traces } = generateMockSEGYData();
    const fileId = uuidv4();
    
    const segyDir = path.join(dataDir, 'segy');
    if (!fs.existsSync(segyDir)) {
      fs.mkdirSync(segyDir, { recursive: true });
    }

    const metaPath = path.join(segyDir, `${fileId}_meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify({
      id: fileId,
      filename: 'mock_data.segy',
      header,
      isMock: true,
      createdAt: new Date().toISOString()
    }, null, 2));

    const { points, values } = extractDataPoints(traces);

    res.json({
      fileId,
      header,
      preview: getSEGYPreview(traces),
      controlPoints: points,
      values,
      isMock: true
    });
  } catch (error: any) {
    console.error('Mock SEGY generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:fileId', (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const meta = loadSEGYMeta(fileId, dataDir);

    if (!meta) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (meta.isMock) {
      const { header, traces } = generateMockSEGYData();
      const { points, values } = extractDataPoints(traces);
      res.json({
        header,
        traces: traces.slice(0, 10),
        controlPoints: points,
        values
      });
    } else {
      const filePath = path.join(dataDir, 'segy', `${fileId}.segy`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const { header, traces } = parseSEGYFile(filePath);
      const { points, values } = extractDataPoints(traces);
      
      res.json({
        header,
        traces: traces.slice(0, 10),
        controlPoints: points,
        values
      });
    }
  } catch (error: any) {
    console.error('SEGY load error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:fileId', (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const segyDir = path.join(dataDir, 'segy');
    
    const filesToDelete = [
      path.join(segyDir, `${fileId}.segy`),
      path.join(segyDir, `${fileId}_meta.json`)
    ];

    for (const file of filesToDelete) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('SEGY delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:fileId/preview', (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const meta = loadSEGYMeta(fileId, dataDir);

    if (!meta) {
      return res.status(404).json({ error: 'File not found' });
    }

    let traces;
    if (meta.isMock) {
      const result = generateMockSEGYData();
      traces = result.traces;
    } else {
      const filePath = path.join(dataDir, 'segy', `${fileId}.segy`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      const result = parseSEGYFile(filePath);
      traces = result.traces;
    }

    const preview = getSEGYPreview(traces);
    res.json({ preview });
  } catch (error: any) {
    console.error('SEGY preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
