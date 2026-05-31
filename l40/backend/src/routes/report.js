import { Router } from 'express';
import { generateInspectionReport } from '../services/reportGenerator.js';

const router = Router();

router.get('/:inspectionId', async (req, res, next) => {
  try {
    const buffer = await generateInspectionReport(parseInt(req.params.inspectionId));
    const filename = `inspection-report-${req.params.inspectionId}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    if (err.message === 'Inspection not found') {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
