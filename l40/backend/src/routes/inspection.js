import { Router } from 'express';
import { query } from '../db/init.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { equipment_id } = req.query;
    if (equipment_id) {
      const result = await query(
        'SELECT * FROM inspections WHERE equipment_id = $1 ORDER BY created_at DESC',
        [equipment_id]
      );
      return res.json(result.rows);
    }
    const result = await query('SELECT * FROM inspections ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const inspectionResult = await query('SELECT * FROM inspections WHERE id = $1', [req.params.id]);
    if (inspectionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Inspection not found' });
    }
    const inspection = inspectionResult.rows[0];
    const defectsResult = await query(
      'SELECT * FROM defects WHERE inspection_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    res.json({ ...inspection, defects: defectsResult.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { equipment_id, inspector, status, notes } = req.body;
    if (!equipment_id || !inspector) {
      return res.status(400).json({ error: 'equipment_id and inspector are required' });
    }
    const equipmentCheck = await query('SELECT id FROM equipment WHERE id = $1', [equipment_id]);
    if (equipmentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }
    const result = await query(
      'INSERT INTO inspections (equipment_id, inspector, status, notes) VALUES ($1, $2, $3, $4) RETURNING *',
      [equipment_id, inspector, status || 'in_progress', notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { status, notes, inspector } = req.body;
    const existing = await query('SELECT * FROM inspections WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Inspection not found' });
    }
    const current = existing.rows[0];
    const result = await query(
      'UPDATE inspections SET status = $1, notes = $2, inspector = $3 WHERE id = $4 RETURNING *',
      [status || current.status, notes !== undefined ? notes : current.notes, inspector || current.inspector, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
