import { Router, type Request, type Response } from 'express'
import { influxDB } from '../services/index.js'

const router = Router()

function computeHeatmapDiff(
  current: number[][],
  previous: number[][],
  threshold: number = 0.5
): {
  countDiff: number
  percentage: number
  highDiffRegions: { x: number; y: number; diff: number }[]
} {
  const res = current.length
  let currentSum = 0
  let previousSum = 0
  const highDiffRegions: { x: number; y: number; diff: number }[] = []

  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      currentSum += current[y][x]
      previousSum += previous[y][x]
      const diff = current[y][x] - previous[y][x]
      const maxVal = Math.max(current[y][x], previous[y][x], 1)
      const diffRatio = Math.abs(diff) / maxVal
      if (diffRatio > threshold) {
        highDiffRegions.push({ x, y, diff })
      }
    }
  }

  const countDiff = currentSum - previousSum
  const percentage = previousSum > 0 ? (countDiff / previousSum) * 100 : currentSum > 0 ? 100 : 0

  return { countDiff, percentage, highDiffRegions }
}

async function getSnapshotData(
  sourceId: string,
  time: Date,
  resolution: number
): Promise<{ time: string; count: number; heatmap: number[][]; anomalies: any[] }> {
  const oneHour = 60 * 60 * 1000
  const start = new Date(time.getTime() - oneHour)
  const end = new Date(time.getTime() + oneHour)

  const heatmapData = await influxDB.queryHeatmap(sourceId, start, end, resolution)
  const trendData = await influxDB.queryCountTrend(sourceId, start, end, '15m')

  let count = 0
  if (trendData.length > 0) {
    const midPoint = Math.floor(trendData.length / 2)
    count = trendData[midPoint]?.count || 0
  }

  const anomalies = heatmapData.grid
    .flatMap((row, y) =>
      row
        .map((val, x) => ({ x, y, value: val }))
        .filter(v => v.value > (heatmapData.maxDensity * 0.8))
    )
    .slice(0, 10)

  return {
    time: time.toISOString(),
    count,
    heatmap: heatmapData.grid,
    anomalies
  }
}

router.get('/compare/:sourceId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceId } = req.params
    const { time, resolution } = req.query

    const currentTime = time ? new Date(time as string) : new Date()
    const resNum = parseInt(resolution as string) || 20
    const previousTime = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000)

    const [current, previous] = await Promise.all([
      getSnapshotData(sourceId, currentTime, resNum),
      getSnapshotData(sourceId, previousTime, resNum)
    ])

    const diff = computeHeatmapDiff(current.heatmap, previous.heatmap, 0.5)

    res.json({
      success: true,
      data: {
        current,
        previous,
        diff
      }
    })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to compare snapshots' })
  }
})

export default router
