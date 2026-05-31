import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { uploadFile, getFileUrl } from '../minio.js';

const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

router.post('/model', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const name = `${uuidv4()}-${req.file.originalname}`;
    await uploadFile('models', name, req.file.buffer, req.file.mimetype || 'model/gltf-binary');
    const url = await getFileUrl('models', name);
    res.status(201).json({ name, url });
  } catch (err) {
    next(err);
  }
});

router.post('/photo', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const name = `${uuidv4()}-${req.file.originalname}`;
    await uploadFile('defect-photos', name, req.file.buffer, req.file.mimetype || 'image/jpeg');
    const url = await getFileUrl('defect-photos', name);
    res.status(201).json({ name, url });
  } catch (err) {
    next(err);
  }
});

export default router;
