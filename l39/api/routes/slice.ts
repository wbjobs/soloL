import { Router, Request, Response } from 'express';
import { loadGrid, getFormations } from '../services/gridService';
import { generateSlice, generateGridSliceVertices } from '../services/sliceService';
import { SliceParams } from '../../shared/types';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  try {
    const { gridId, params } = req.body;

    if (!gridId || !params) {
      return res.status(400).json({ error: 'Grid ID and params are required' });
    }

    const grid = loadGrid(gridId);
    if (!grid) {
      return res.status(404).json({ error: 'Grid not found' });
    }

    const formations = getFormations();
    const result = generateSlice(grid, params, formations);

    res.json(result);
  } catch (error: any) {
    console.error('Slice generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/mesh', (req: Request, res: Response) => {
  try {
    const { gridId, params } = req.body;

    if (!gridId || !params) {
      return res.status(400).json({ error: 'Grid ID and params are required' });
    }

    const grid = loadGrid(gridId);
    if (!grid) {
      return res.status(404).json({ error: 'Grid not found' });
    }

    const mesh = generateGridSliceVertices(grid, params);
    
    if (!mesh) {
      return res.json({ vertices: [], colors: [], indices: [] });
    }

    res.json(mesh);
  } catch (error: any) {
    console.error('Slice mesh generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
