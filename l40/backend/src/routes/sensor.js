import { Router } from 'express';
import { query } from '../db/init.js';
import { getLatestSensorData } from '../mqtt.js';

const router = Router();

router.get('/:equipmentId/latest', async (req, res, next) => {
  try {
    const { equipmentId } = req.params;
    const cached = getLatestSensorData(equipmentId);
    if (!cached) {
      const result = await query(
        'SELECT DISTINCT ON (sensor_type) sensor_type, value, unit, timestamp FROM sensor_data WHERE equipment_id = $1 ORDER BY sensor_type, timestamp DESC',
        [equipmentId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'No sensor data found for this equipment' });
      }
      const data = {};
      for (const row of result.rows) {
        data[row.sensor_type] = { value: row.value, unit: row.unit, timestamp: row.timestamp };
      }
      return res.json(data);
    }
    res.json(cached);
  } catch (err) {
    next(err);
  }
});

router.get('/:equipmentId/history', async (req, res, next) => {
  try {
    const { equipmentId } = req.params;
    const { from, to, sensor_type } = req.query;

    let sql = 'SELECT * FROM sensor_data WHERE equipment_id = $1';
    const params = [equipmentId];
    let paramIndex = 2;

    if (from) {
      sql += ` AND timestamp >= $${paramIndex}`;
      params.push(from);
      paramIndex++;
    }
    if (to) {
      sql += ` AND timestamp <= $${paramIndex}`;
      params.push(to);
      paramIndex++;
    }
    if (sensor_type) {
      sql += ` AND sensor_type = $${paramIndex}`;
      params.push(sensor_type);
      paramIndex++;
    }

    sql += ' ORDER BY timestamp DESC LIMIT 1000';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

export default router;
