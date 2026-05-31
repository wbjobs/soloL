import { Router, Request, Response } from 'express';
import * as path from 'path';
import { 
  saveTrajectory, 
  loadTrajectory, 
  deleteTrajectory, 
  analyzeTrajectory, 
  saveReport, 
  loadReport,
  generateDefaultTrajectory,
  sampleTrajectory 
} from '../services/trajectoryService';
import { loadGrid, getFormations } from '../services/gridService';
import { WellTrajectory } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const dataDir = path.join(process.cwd(), 'data');

router.post('/analyze', (req: Request, res: Response) => {
  try {
    const { gridId, trajectory } = req.body;

    if (!gridId || !trajectory) {
      return res.status(400).json({ error: 'Grid ID and trajectory are required' });
    }

    const grid = loadGrid(gridId);
    if (!grid) {
      return res.status(404).json({ error: 'Grid not found' });
    }

    const formations = getFormations();
    const report = analyzeTrajectory(grid, trajectory, formations);
    
    const reportId = saveReport(report);

    res.json({
      ...report,
      reportId
    });
  } catch (error: any) {
    console.error('Trajectory analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/default', (req: Request, res: Response) => {
  try {
    const trajectory = generateDefaultTrajectory();
    trajectory.samplePoints = sampleTrajectory(trajectory, 200);
    res.json(trajectory);
  } catch (error: any) {
    console.error('Default trajectory error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const trajectory: WellTrajectory = req.body;
    
    if (!trajectory.segments || trajectory.segments.length === 0) {
      return res.status(400).json({ error: 'Trajectory segments are required' });
    }

    trajectory.samplePoints = sampleTrajectory(trajectory, 200);
    const id = saveTrajectory(trajectory);

    res.json({ id, ...trajectory });
  } catch (error: any) {
    console.error('Trajectory save error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:trajectoryId', (req: Request, res: Response) => {
  try {
    const { trajectoryId } = req.params;
    const trajectory = loadTrajectory(trajectoryId);

    if (!trajectory) {
      return res.status(404).json({ error: 'Trajectory not found' });
    }

    if (!trajectory.samplePoints || trajectory.samplePoints.length === 0) {
      trajectory.samplePoints = sampleTrajectory(trajectory, 200);
    }

    res.json(trajectory);
  } catch (error: any) {
    console.error('Trajectory load error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:trajectoryId', (req: Request, res: Response) => {
  try {
    const { trajectoryId } = req.params;
    const success = deleteTrajectory(trajectoryId);
    res.json({ success });
  } catch (error: any) {
    console.error('Trajectory delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/report/:reportId', (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;
    const report = loadReport(reportId);

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(report);
  } catch (error: any) {
    console.error('Report load error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/sample', (req: Request, res: Response) => {
  try {
    const { trajectory, samplesPerSegment } = req.body;
    
    if (!trajectory) {
      return res.status(400).json({ error: 'Trajectory is required' });
    }

    const points = sampleTrajectory(trajectory, samplesPerSegment || 200);
    res.json({ points });
  } catch (error: any) {
    console.error('Trajectory sampling error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
