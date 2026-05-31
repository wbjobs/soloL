import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const DATA_DIR = path.join(__dirname, '../../data/potree');

router.post('/:gridId/generate', async (req, res) => {
  try {
    const { gridId } = req.params;
    
    const { generatePotreeOctree } = await import('../services/gridServiceAdvanced.js');
    const { default: FORMATIONS } = await import('../data/formations.json', { assert: { type: 'json' } });
    
    const { loadGrid } = await import('../services/gridServiceAdvanced.js');
    const grid = loadGrid(gridId);
    
    if (!grid) {
      return res.status(404).json({ error: 'Grid not found' });
    }
    
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    generatePotreeOctree(gridId, grid, FORMATIONS);
    
    res.json({ success: true, gridId });
  } catch (error) {
    console.error('Error generating Potree octree:', error);
    res.status(500).json({ error: 'Failed to generate Potree octree' });
  }
});

router.get('/:gridId/metadata', async (req, res) => {
  try {
    const { gridId } = req.params;
    const metadataPath = path.join(DATA_DIR, gridId, 'metadata.json');
    
    if (!fs.existsSync(metadataPath)) {
      const { generatePotreeOctree } = await import('../services/gridServiceAdvanced.js');
      const { default: FORMATIONS } = await import('../data/formations.json', { assert: { type: 'json' } });
      const { loadGrid } = await import('../services/gridServiceAdvanced.js');
      const grid = loadGrid(gridId);
      
      if (!grid) {
        return res.status(404).json({ error: 'Grid not found' });
      }
      
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      
      generatePotreeOctree(gridId, grid, FORMATIONS);
    }
    
    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      res.json(metadata);
    } else {
      res.status(404).json({ error: 'Potree metadata not found' });
    }
  } catch (error) {
    console.error('Error getting Potree metadata:', error);
    res.status(500).json({ error: 'Failed to get Potree metadata' });
  }
});

router.get('/:gridId/nodes/:nodeId', async (req, res) => {
  try {
    const { gridId, nodeId } = req.params;
    const nodePath = path.join(DATA_DIR, gridId, `${nodeId}.bin`);
    
    if (!fs.existsSync(nodePath)) {
      return res.status(404).json({ error: 'Node data not found' });
    }
    
    const data = fs.readFileSync(nodePath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(data);
  } catch (error) {
    console.error('Error getting Potree node data:', error);
    res.status(500).json({ error: 'Failed to get Potree node data' });
  }
});

export default router;
