import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/init.js';
import { uploadFile, getFileUrl } from '../minio.js';

const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

router.post('/', upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'voice', maxCount: 1 },
]), async (req, res, next) => {
  try {
    const { inspection_id, position, description, severity } = req.body;
    if (!inspection_id || !position) {
      return res.status(400).json({ error: 'inspection_id and position are required' });
    }

    const inspectionCheck = await query('SELECT id FROM inspections WHERE id = $1', [inspection_id]);
    if (inspectionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Inspection not found' });
    }

    let photoUrl = null;
    let voiceUrl = null;

    const photoFile = req.files?.photo?.[0];
    if (photoFile) {
      const photoName = `${uuidv4()}-${photoFile.originalname}`;
      await uploadFile('defect-photos', photoName, photoFile.buffer, photoFile.mimetype);
      photoUrl = photoName;
    }

    const voiceFile = req.files?.voice?.[0];
    if (voiceFile) {
      const voiceName = `${uuidv4()}-${voiceFile.originalname}`;
      await uploadFile('voice-notes', voiceName, voiceFile.buffer, voiceFile.mimetype);
      voiceUrl = voiceName;
    }

    let parsedPosition;
    try {
      parsedPosition = typeof position === 'string' ? JSON.parse(position) : position;
    } catch {
      return res.status(400).json({ error: 'Invalid position JSON' });
    }

    const result = await query(
      'INSERT INTO defects (inspection_id, position, photo_url, voice_url, description, severity) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [inspection_id, JSON.stringify(parsedPosition), photoUrl, voiceUrl, description || null, severity || 'medium']
    );

    const defect = result.rows[0];
    if (defect.photo_url) {
      defect.photo_url_signed = await getFileUrl('defect-photos', defect.photo_url);
    }
    if (defect.voice_url) {
      defect.voice_url_signed = await getFileUrl('voice-notes', defect.voice_url);
    }

    res.status(201).json(defect);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { inspection_id } = req.query;
    if (!inspection_id) {
      return res.status(400).json({ error: 'inspection_id query parameter is required' });
    }
    const result = await query(
      'SELECT * FROM defects WHERE inspection_id = $1 ORDER BY created_at',
      [inspection_id]
    );
    const defects = result.rows;
    for (const defect of defects) {
      if (defect.photo_url) {
        defect.photo_url_signed = await getFileUrl('defect-photos', defect.photo_url);
      }
      if (defect.voice_url) {
        defect.voice_url_signed = await getFileUrl('voice-notes', defect.voice_url);
      }
    }
    res.json(defects);
  } catch (err) {
    next(err);
  }
});

export default router;
