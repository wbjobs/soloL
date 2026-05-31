import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/init.js';

const router = Router();

function generateShareCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

router.post('/', async (req, res, next) => {
  try {
    const {
      anchor_id,
      equipment_id,
      position,
      rotation,
      creator,
      shared = false,
      anchor_data,
      expires_at,
    } = req.body;

    if (!anchor_id) {
      return res.status(400).json({ error: 'anchor_id is required' });
    }
    if (!position) {
      return res.status(400).json({ error: 'position is required' });
    }

    if (equipment_id) {
      const equipmentCheck = await query('SELECT id FROM equipment WHERE id = $1', [equipment_id]);
      if (equipmentCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Equipment not found' });
      }
    }

    let parsedPosition;
    let parsedRotation;
    try {
      parsedPosition = typeof position === 'string' ? JSON.parse(position) : position;
      parsedRotation = rotation ? (typeof rotation === 'string' ? JSON.parse(rotation) : rotation) : { x: 0, y: 0, z: 0, w: 1 };
    } catch {
      return res.status(400).json({ error: 'Invalid position or rotation JSON' });
    }

    const expiresAt = expires_at
      ? new Date(expires_at)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const result = await query(
      `INSERT INTO spatial_anchors
       (anchor_id, equipment_id, position, rotation, creator, shared, anchor_data, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (anchor_id) DO UPDATE SET
         equipment_id = COALESCE(EXCLUDED.equipment_id, spatial_anchors.equipment_id),
         position = EXCLUDED.position,
         rotation = EXCLUDED.rotation,
         creator = COALESCE(EXCLUDED.creator, spatial_anchors.creator),
         shared = EXCLUDED.shared,
         anchor_data = COALESCE(EXCLUDED.anchor_data, spatial_anchors.anchor_data),
         expires_at = COALESCE(EXCLUDED.expires_at, spatial_anchors.expires_at)
       RETURNING *`,
      [
        anchor_id,
        equipment_id || null,
        JSON.stringify(parsedPosition),
        JSON.stringify(parsedRotation),
        creator || null,
        shared,
        anchor_data || null,
        expiresAt,
      ]
    );

    const anchor = result.rows[0];
    res.status(201).json(anchor);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { equipment_id, lat, lon, radius = 100 } = req.query;

    let queryStr = 'SELECT * FROM spatial_anchors WHERE expires_at > NOW()';
    const params = [];

    if (equipment_id) {
      params.push(equipment_id);
      queryStr += ` AND equipment_id = $${params.length}`;
    }

    queryStr += ' ORDER BY created_at DESC';

    const result = await query(queryStr, params);
    let anchors = result.rows;

    if (lat !== undefined && lon !== undefined) {
      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);
      const radiusNum = parseFloat(radius);

      anchors = anchors.filter((a) => {
        if (a.position && a.position.lat !== undefined && a.position.lon !== undefined) {
          const dist = haversineDistance(latNum, lonNum, a.position.lat, a.position.lon);
          a.distance = dist;
          return dist <= radiusNum;
        }
        return true;
      }).sort((a, b) => (a.distance || 0) - (b.distance || 0));
    }

    res.json(anchors);
  } catch (err) {
    next(err);
  }
});

router.get('/nearby', async (req, res, next) => {
  try {
    const { lat, lon, radius = 100 } = req.query;

    if (lat === undefined || lon === undefined) {
      return res.status(400).json({ error: 'lat and lon query parameters are required' });
    }

    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const radiusNum = parseFloat(radius);

    const result = await query(
      'SELECT * FROM spatial_anchors WHERE expires_at > NOW() ORDER BY created_at DESC',
      []
    );

    const anchors = result.rows
      .map((a) => {
        let distance = Infinity;
        if (a.position && a.position.lat !== undefined && a.position.lon !== undefined) {
          distance = haversineDistance(latNum, lonNum, a.position.lat, a.position.lon);
        }
        return { ...a, distance };
      })
      .filter((a) => a.distance <= radiusNum)
      .sort((a, b) => a.distance - b.distance);

    res.json(anchors);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      'SELECT * FROM spatial_anchors WHERE anchor_id = $1 OR id = $2',
      [id, isNaN(parseInt(id)) ? -1 : parseInt(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Anchor not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { equipment_id, position, rotation, shared, anchor_data, expires_at } = req.body;

    const existing = await query(
      'SELECT * FROM spatial_anchors WHERE anchor_id = $1 OR id = $2',
      [id, isNaN(parseInt(id)) ? -1 : parseInt(id)]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Anchor not found' });
    }

    const anchor = existing.rows[0];

    const updates = [];
    const params = [];

    if (equipment_id !== undefined) {
      if (equipment_id !== null) {
        const equipmentCheck = await query('SELECT id FROM equipment WHERE id = $1', [equipment_id]);
        if (equipmentCheck.rows.length === 0) {
          return res.status(404).json({ error: 'Equipment not found' });
        }
      }
      params.push(equipment_id);
      updates.push(`equipment_id = $${params.length}`);
    }

    if (position !== undefined) {
      try {
        const parsedPosition = typeof position === 'string' ? JSON.parse(position) : position;
        params.push(JSON.stringify(parsedPosition));
        updates.push(`position = $${params.length}`);
      } catch {
        return res.status(400).json({ error: 'Invalid position JSON' });
      }
    }

    if (rotation !== undefined) {
      try {
        const parsedRotation = typeof rotation === 'string' ? JSON.parse(rotation) : rotation;
        params.push(JSON.stringify(parsedRotation));
        updates.push(`rotation = $${params.length}`);
      } catch {
        return res.status(400).json({ error: 'Invalid rotation JSON' });
      }
    }

    if (shared !== undefined) {
      params.push(shared);
      updates.push(`shared = $${params.length}`);
    }

    if (anchor_data !== undefined) {
      params.push(anchor_data);
      updates.push(`anchor_data = $${params.length}`);
    }

    if (expires_at !== undefined) {
      params.push(new Date(expires_at));
      updates.push(`expires_at = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.json(anchor);
    }

    params.push(anchor.id);
    const updateQuery = `UPDATE spatial_anchors SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`;

    const result = await query(updateQuery, params);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM spatial_anchors WHERE anchor_id = $1 OR id = $2 RETURNING *',
      [id, isNaN(parseInt(id)) ? -1 : parseInt(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Anchor not found' });
    }

    res.json({ message: 'Anchor deleted successfully', anchor: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/share', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { shareCode, expiresAt } = req.body;

    const existing = await query(
      'SELECT * FROM spatial_anchors WHERE anchor_id = $1 OR id = $2',
      [id, isNaN(parseInt(id)) ? -1 : parseInt(id)]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Anchor not found' });
    }

    const anchor = existing.rows[0];
    const code = shareCode || generateShareCode();
    const expiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);

    await query(
      'UPDATE spatial_anchors SET shared = true WHERE id = $1',
      [anchor.id]
    );

    const shareRecord = {
      shareCode: code,
      anchorId: anchor.anchor_id,
      anchorData: anchor.anchor_data || JSON.stringify(anchor),
      expiresAt: expiry.toISOString(),
      createdAt: new Date().toISOString(),
    };

    try {
      await query(
        `INSERT INTO spatial_anchor_shares (share_code, anchor_id, anchor_data, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (share_code) DO UPDATE SET
           anchor_id = EXCLUDED.anchor_id,
           anchor_data = EXCLUDED.anchor_data,
           expires_at = EXCLUDED.expires_at`,
        [code, anchor.anchor_id, shareRecord.anchorData, expiry]
      );
    } catch (err) {
      if (err.message && err.message.includes('spatial_anchor_shares')) {
        console.log('[SpatialAnchors] Share table does not exist, skipping persistence');
      } else {
        throw err;
      }
    }

    res.json({
      shareCode: code,
      shareUrl: `/anchor/${code}`,
      expiresAt: expiry.toISOString(),
      anchorId: anchor.anchor_id,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/import', async (req, res, next) => {
  try {
    const { shareCode } = req.body;

    if (!shareCode) {
      return res.status(400).json({ error: 'shareCode is required' });
    }

    const normalizedCode = shareCode.toUpperCase().trim();

    let shareRecord = null;
    try {
      const result = await query(
        'SELECT * FROM spatial_anchor_shares WHERE share_code = $1 AND expires_at > NOW()',
        [normalizedCode]
      );
      if (result.rows.length > 0) {
        shareRecord = result.rows[0];
      }
    } catch (err) {
      if (err.message && err.message.includes('spatial_anchor_shares')) {
        console.log('[SpatialAnchors] Share table does not exist');
      } else {
        throw err;
      }
    }

    if (!shareRecord) {
      const anchorResult = await query(
        'SELECT * FROM spatial_anchors WHERE anchor_id = $1 OR anchor_id = $2',
        [normalizedCode, shareCode]
      );
      if (anchorResult.rows.length > 0) {
        return res.json(anchorResult.rows[0]);
      }
      return res.status(404).json({ error: 'Share code not found or expired' });
    }

    const anchorResult = await query(
      'SELECT * FROM spatial_anchors WHERE anchor_id = $1',
      [shareRecord.anchor_id]
    );

    if (anchorResult.rows.length === 0) {
      return res.status(404).json({ error: 'Anchor not found' });
    }

    res.json(anchorResult.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
