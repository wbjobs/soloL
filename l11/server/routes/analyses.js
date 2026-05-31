const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const analysisService = require('../services/analysisService');
const comparisonService = require('../services/comparisonService');
const taskQueue = require('../services/taskQueue');
const resultConsumer = require('../services/resultConsumer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

router.post('/upload', upload.array('files', parseInt(process.env.MAX_BATCH_SIZE) || 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const maxBatchSize = parseInt(process.env.MAX_BATCH_SIZE) || 10;
    if (req.files.length > maxBatchSize) {
      return res.status(400).json({ 
        error: `Maximum ${maxBatchSize} files allowed per batch` 
      });
    }

    const batchId = await analysisService.createBatchJob(req.files.length);
    const results = [];
    const uploadDir = process.env.UPLOAD_DIR || './uploads';

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const analysisId = await analysisService.createAnalysisRecord(file, batchId);
      const filePath = path.join(uploadDir, file.filename);
      
      results.push({
        analysis_id: analysisId,
        original_name: file.originalname,
        filename: file.filename,
        file_size: file.size,
        status: 'queued',
      });

      await taskQueue.enqueueTask({
        analysis_id: analysisId,
        file_path: filePath,
        batch_id: batchId,
        original_name: file.originalname,
      });
    }

    res.status(202).json({
      batch_id: batchId,
      total_files: req.files.length,
      analyses: results,
      message: 'Files accepted for processing. Check status for progress.',
    });
  } catch (error) {
    next(error);
  }
});

router.get('/status/:analysisId', async (req, res, next) => {
  try {
    const status = await resultConsumer.getAnalysisStatus(req.params.analysisId);
    if (!status) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    res.json({ analysis_id: req.params.analysisId, ...status });
  } catch (error) {
    next(error);
  }
});

router.get('/queue/stats', async (req, res, next) => {
  try {
    const queueLength = await taskQueue.getQueueLength();
    res.json({
      queue_length: queueLength,
      redis_connected: true,
    });
  } catch (error) {
    res.json({
      queue_length: 0,
      redis_connected: false,
      error: error.message,
    });
  }
});

router.get('/batch/:batchId', async (req, res, next) => {
  try {
    const status = await analysisService.getBatchStatus(req.params.batchId);
    if (!status) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    res.json(status);
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const history = await analysisService.getAnalysisHistory(limit, offset);
    res.json(history);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const analysis = await analysisService.getAnalysisById(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    res.json(analysis);
  } catch (error) {
    next(error);
  }
});

router.get('/:id/waveform', async (req, res, next) => {
  try {
    const analysis = await analysisService.getAnalysisById(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    const bins = parseInt(req.query.bins) || 100;
    const waveform = analysisService.generateWaveformData(analysis.notes, analysis.duration_seconds, bins);
    res.json({ waveform, duration: analysis.duration_seconds });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/export', async (req, res, next) => {
  try {
    const exportData = await analysisService.exportToJson(req.params.id);
    if (!exportData) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="analysis_${req.params.id}.json"`);
    res.json(exportData);
  } catch (error) {
    next(error);
  }
});

router.post('/export/batch', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No analysis IDs provided' });
    }
    
    const exportData = await analysisService.exportBatchToJson(ids);
    const exportId = uuidv4();
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="batch_export_${exportId}.json"`);
    res.json(exportData);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await analysisService.deleteAnalysis(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    res.json({ message: 'Analysis deleted successfully' });
  } catch (error) {
    next(error);
  }
});

router.post('/compare', async (req, res, next) => {
  try {
    const { analysis_id1, analysis_id2 } = req.body;
    
    if (!analysis_id1 || !analysis_id2) {
      return res.status(400).json({ 
        error: 'Both analysis_id1 and analysis_id2 are required' 
      });
    }
    
    if (analysis_id1 === analysis_id2) {
      return res.status(400).json({ 
        error: 'Cannot compare an analysis with itself' 
      });
    }
    
    const comparison = await comparisonService.compare(analysis_id1, analysis_id2);
    res.json(comparison);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/compare/search', async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Search query "q" is required' });
    }
    
    const limit = parseInt(req.query.limit) || 20;
    const results = await comparisonService.searchByTags(q, limit);
    res.json({ results, count: results.length });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
