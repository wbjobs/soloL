import { Router, Request, Response } from 'express';
import * as path from 'path';
import { getFileList, ensureDataDirs } from '../services/fileService';

const router = Router();

const dataDir = path.join(process.cwd(), 'data');

router.get('/list', (req: Request, res: Response) => {
  try {
    ensureDataDirs(dataDir);
    const fileList = getFileList(dataDir);
    res.json(fileList);
  } catch (error: any) {
    console.error('File list error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
