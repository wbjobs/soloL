import { Router } from 'express';
import { query } from '../db/init.js';
import { getLatestSensorData } from '../mqtt.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM equipment ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/qr/:code', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM equipment WHERE qr_code = $1', [req.params.code]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }
    const equipment = result.rows[0];
    const sensorData = getLatestSensorData(equipment.id);
    res.json({ ...equipment, latest_sensor_data: sensorData });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM equipment WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Equipment not found' });
    }
    const equipment = result.rows[0];
    const sensorData = getLatestSensorData(equipment.id);
    res.json({ ...equipment, latest_sensor_data: sensorData });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { qr_code, name, model_path, location, specs } = req.body;
    if (!qr_code || !name) {
      return res.status(400).json({ error: 'qr_code and name are required' });
    }
    const result = await query(
      'INSERT INTO equipment (qr_code, name, model_path, location, specs) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [qr_code, name, model_path || null, location || null, JSON.stringify(specs || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Equipment with this QR code already exists' });
    }
    next(err);
  }
});

export default router;
