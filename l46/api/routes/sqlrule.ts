import { Router, type Request, type Response } from 'express'
import type {
  SQLRuleConfig,
  SQLRuleResult,
} from '../../shared/types.js'
import { dataStore } from '../lib/datastore.js'
import { exportSQLRule } from '../lib/sql_rules.js'

const router = Router()

router.post('/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const { modelId, config } = req.body as {
      modelId: string
      config: SQLRuleConfig
    }

    if (!modelId || !config) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: modelId and config',
      })
      return
    }

    const model = dataStore.getHMMModel(modelId)
    if (!model) {
      res.status(404).json({
        success: false,
        error: 'Model not found',
      })
      return
    }

    const result = exportSQLRule(model, config)
    dataStore.saveSQLRuleResult(result)

    res.status(200).json({
      success: true,
      data: result,
      message: `SQL rule exported successfully for ${config.databaseType}`,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/rules', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rules = dataStore.getAllSQLRuleResults()
    res.status(200).json({
      success: true,
      data: rules,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.get('/rules/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const rule = dataStore.getSQLRuleResult(id)

    if (!rule) {
      res.status(404).json({
        success: false,
        error: 'SQL rule not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      data: rule,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.delete('/rules/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const deleted = dataStore.deleteSQLRuleResult(id)

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'SQL rule not found',
      })
      return
    }

    res.status(200).json({
      success: true,
      message: 'SQL rule deleted successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

router.post('/preview', async (req: Request, res: Response): Promise<void> => {
  try {
    const { modelId, databaseType } = req.body as {
      modelId: string
      databaseType: string
    }

    if (!modelId || !databaseType) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: modelId and databaseType',
      })
      return
    }

    const model = dataStore.getHMMModel(modelId)
    if (!model) {
      res.status(404).json({
        success: false,
        error: 'Model not found',
      })
      return
    }

    const config: SQLRuleConfig = {
      ruleName: 'Preview Rule',
      ruleDescription: 'Temporary preview rule',
      databaseType: databaseType as any,
      thresholdK: 2,
      timeColumn: 'timestamp',
      valueColumn: 'value',
      assetColumn: 'asset',
      includeAssetFilter: false,
    }

    const result = exportSQLRule(model, config)

    res.status(200).json({
      success: true,
      sql: result.sql,
      transitions: result.stateTransitions,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
})

export default router
