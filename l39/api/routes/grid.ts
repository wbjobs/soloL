import { Router, Request, Response } from 'express';
import * as path from 'path';
import { startKrigingInterpolation, getKrigingProgress, generateMockGrid, loadGrid, getGridMeta, deleteGrid, getFormations, saveGrid } from '../services/gridService';
import { KrigingParams } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const dataDir = path.join(process.cwd(), 'data');

router.post('/kriging', (req: Request, res: Response) => {
  try {
    const { fileId, params, dimensions, controlPoints, values } = req.body;

    if (!controlPoints || !values || controlPoints.length === 0) {
      return res.status(400).json({ error: 'Control points are required' });
    }

    const defaultParams: KrigingParams = {
      model: 'spherical',
      range: 200,
      sill: 1.0,
      nugget: 0.01,
      searchRadius: 150,
      maxNeighbors: 12,
      ...params
    };

    const defaultDimensions = {
      nx: 200,
      ny: 200,
      nz: 100,
      ...dimensions
    };

    const result = startKrigingInterpolation(controlPoints, values, defaultParams, defaultDimensions);

    res.json(result);
  } catch (error: any) {
    console.error('Kriging start error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:gridId/progress', (req: Request, res: Response) => {
  try {
    const { gridId } = req.params;
    const progress = getKrigingProgress(gridId);
    res.json(progress);
  } catch (error: any) {
    console.error('Kriging progress error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/mock', (req: Request, res: Response) => {
  try {
    const grid = generateMockGrid();
    const gridId = uuidv4();
    saveGrid(gridId, grid);

    res.json({
      gridId,
      progress: 100,
      status: 'completed'
    });
  } catch (error: any) {
    console.error('Mock grid generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:gridId', (req: Request, res: Response) => {
  try {
    const { gridId } = req.params;
    const grid = loadGrid(gridId);

    if (!grid) {
      return res.status(404).json({ error: 'Grid not found' });
    }

    res.json(grid);
  } catch (error: any) {
    console.error('Grid load error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:gridId/meta', (req: Request, res: Response) => {
  try {
    const { gridId } = req.params;
    const meta = getGridMeta(gridId);

    if (!meta) {
      return res.status(404).json({ error: 'Grid not found' });
    }

    res.json(meta);
  } catch (error: any) {
    console.error('Grid meta error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/formations', (req: Request, res: Response) => {
  try {
    const formations = getFormations();
    res.json(formations);
  } catch (error: any) {
    console.error('Formations error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:gridId', (req: Request, res: Response) => {
  try {
    const { gridId } = req.params;
    const success = deleteGrid(gridId);
    res.json({ success });
  } catch (error: any) {
    console.error('Grid delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
