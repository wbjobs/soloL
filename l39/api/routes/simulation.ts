import { Router } from 'express';
import { SimulationParams, MonteCarloParams, KrigingParams } from '../../shared/types';

const router = Router();

router.post('/simulation/start', async (req, res) => {
  try {
    const { gridId, params, wellPoints } = req.body as {
      gridId: string;
      params: SimulationParams;
      wellPoints: { x: number; y: number; z: number }[];
    };
    
    const { startFlowSimulation } = await import('../services/simulationService.js');
    
    const result = startFlowSimulation(gridId, params, wellPoints);
    
    res.json(result);
  } catch (error) {
    console.error('Error starting flow simulation:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to start flow simulation' });
  }
});

router.get('/simulation/:simulationId/progress', async (req, res) => {
  try {
    const { simulationId } = req.params;
    
    const { getSimulationProgress } = await import('../services/simulationService.js');
    
    const progress = getSimulationProgress(simulationId);
    
    res.json(progress);
  } catch (error) {
    console.error('Error getting simulation progress:', error);
    res.status(500).json({ error: 'Failed to get simulation progress' });
  }
});

router.get('/simulation/:simulationId/result', async (req, res) => {
  try {
    const { simulationId } = req.params;
    
    const { getSimulationResult } = await import('../services/simulationService.js');
    
    const result = getSimulationResult(simulationId);
    
    if (!result) {
      return res.status(404).json({ error: 'Simulation result not found' });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error getting simulation result:', error);
    res.status(500).json({ error: 'Failed to get simulation result' });
  }
});

router.get('/simulations', async (req, res) => {
  try {
    const { gridId } = req.query;
    
    const { listSimulations } = await import('../services/simulationService.js');
    
    const simulations = listSimulations(gridId as string | undefined);
    
    res.json({ simulations });
  } catch (error) {
    console.error('Error listing simulations:', error);
    res.status(500).json({ error: 'Failed to list simulations' });
  }
});

router.post('/montecarlo/start', async (req, res) => {
  try {
    const { 
      gridId, 
      monteCarloParams, 
      baseKrigingParams, 
      simulationParams, 
      wellPoints 
    } = req.body as {
      gridId: string;
      monteCarloParams: MonteCarloParams;
      baseKrigingParams: KrigingParams;
      simulationParams: SimulationParams;
      wellPoints: { x: number; y: number; z: number }[];
    };
    
    const { startMonteCarloSimulation } = await import('../services/simulationService.js');
    
    const result = startMonteCarloSimulation(
      gridId,
      monteCarloParams,
      baseKrigingParams,
      simulationParams,
      wellPoints
    );
    
    res.json(result);
  } catch (error) {
    console.error('Error starting Monte Carlo simulation:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to start Monte Carlo simulation' });
  }
});

router.get('/montecarlo/:mcId/progress', async (req, res) => {
  try {
    const { mcId } = req.params;
    
    const { getMonteCarloProgress } = await import('../services/simulationService.js');
    
    const progress = getMonteCarloProgress(mcId);
    
    res.json(progress);
  } catch (error) {
    console.error('Error getting Monte Carlo progress:', error);
    res.status(500).json({ error: 'Failed to get Monte Carlo progress' });
  }
});

router.get('/montecarlo/:mcId/result', async (req, res) => {
  try {
    const { mcId } = req.params;
    
    const { getMonteCarloResult } = await import('../services/simulationService.js');
    
    const result = getMonteCarloResult(mcId);
    
    if (!result) {
      return res.status(404).json({ error: 'Monte Carlo result not found' });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error getting Monte Carlo result:', error);
    res.status(500).json({ error: 'Failed to get Monte Carlo result' });
  }
});

router.get('/montecarlo', async (req, res) => {
  try {
    const { gridId } = req.query;
    
    const { listMonteCarloSimulations } = await import('../services/simulationService.js');
    
    const simulations = listMonteCarloSimulations(gridId as string | undefined);
    
    res.json({ simulations });
  } catch (error) {
    console.error('Error listing Monte Carlo simulations:', error);
    res.status(500).json({ error: 'Failed to list Monte Carlo simulations' });
  }
});

export default router;
