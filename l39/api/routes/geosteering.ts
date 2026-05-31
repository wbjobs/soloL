import { Router } from 'express';

const router = Router();

router.post('/info', async (req, res) => {
  try {
    const { gridId, point } = req.body;
    
    const { getGeosteeringInfo } = await import('../services/geosteeringService.js');
    const { default: FORMATIONS } = await import('../data/formations.json', { assert: { type: 'json' } });
    
    const info = getGeosteeringInfo(gridId, point, FORMATIONS);
    
    if (!info) {
      return res.status(404).json({ error: 'Could not calculate geosteering info' });
    }
    
    res.json(info);
  } catch (error) {
    console.error('Error getting geosteering info:', error);
    res.status(500).json({ error: 'Failed to get geosteering info' });
  }
});

router.post('/reservoir-top', async (req, res) => {
  try {
    const { gridId, x, y } = req.body;
    
    const { loadGrid } = await import('../services/gridServiceAdvanced.js');
    const { findFormationTop } = await import('../services/geosteeringService.js');
    
    const grid = loadGrid(gridId);
    if (!grid) {
      return res.status(404).json({ error: 'Grid not found' });
    }
    
    const RESERVOIR_FORMATION_ID = 2;
    const result = findFormationTop(grid, x, y, RESERVOIR_FORMATION_ID);
    
    if (!result) {
      return res.status(404).json({ error: 'Reservoir top not found at this location' });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error getting reservoir top:', error);
    res.status(500).json({ error: 'Failed to get reservoir top' });
  }
});

router.get('/reservoir-surface/:gridId', async (req, res) => {
  try {
    const { gridId } = req.params;
    
    const { getReservoirTopSurface } = await import('../services/geosteeringService.js');
    
    const surface = getReservoirTopSurface(gridId);
    
    if (!surface) {
      return res.status(404).json({ error: 'Could not generate reservoir surface' });
    }
    
    res.json({ points: surface });
  } catch (error) {
    console.error('Error getting reservoir surface:', error);
    res.status(500).json({ error: 'Failed to get reservoir surface' });
  }
});

export default router;
