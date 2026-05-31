<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed } from 'vue'
import * as echarts from 'echarts'
import type { SpeedRecord } from '@/types'
import { formatSpeed } from '@/utils/format'

const props = defineProps<{
  records: SpeedRecord[]
  title?: string
  height?: string
}>()

const chartRef = ref<HTMLDivElement | null>(null)
let chartInstance: echarts.ECharts | null = null

const initChart = () => {
  if (!chartRef.value) return
  chartInstance = echarts.init(chartRef.value, 'dark')
  updateChart()
  window.addEventListener('resize', handleResize)
}

const handleResize = () => {
  chartInstance?.resize()
}

const updateChart = () => {
  if (!chartInstance) return

  const times = props.records.map(r => {
    const date = new Date(r.timestamp)
    return date.toLocaleTimeString('zh-CN', { hour12: false })
  })

  const downloadSpeeds = props.records.map(r => r.download_speed)
  const uploadSpeeds = props.records.map(r => r.upload_speed)

  const option: echarts.EChartsOption = {
    backgroundColor: 'transparent',
    title: {
      text: props.title || 'P2P传输速度',
      textStyle: {
        color: '#E2E8F0',
        fontSize: 14,
        fontWeight: 500,
      },
      left: 10,
      top: 10,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15, 30, 54, 0.95)',
      borderColor: 'rgba(0, 212, 255, 0.3)',
      textStyle: { color: '#E2E8F0' },
      formatter: (params: any) => {
        let html = `<div style="font-family: JetBrains Mono, monospace;">`
        params.forEach((p: any) => {
          const color = p.seriesName === '下载速度' ? '#00D4FF' : '#7C3AED'
          html += `<div style="color: ${color};">${p.marker} ${p.seriesName}: ${formatSpeed(p.value)}</div>`
        })
        html += '</div>'
        return html
      },
    },
    legend: {
      data: ['下载速度', '上传速度'],
      textStyle: { color: '#94A3B8' },
      top: 10,
      right: 10,
    },
    grid: {
      left: 60,
      right: 20,
      top: 60,
      bottom: 40,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: times,
      axisLine: { lineStyle: { color: '#1E3560' } },
      axisLabel: { color: '#64748B', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#1E3560' } },
      axisLabel: {
        color: '#64748B',
        fontSize: 10,
        formatter: (value: number) => formatSpeed(value),
      },
      splitLine: { lineStyle: { color: 'rgba(30, 53, 96, 0.3)' } },
    },
    series: [
      {
        name: '下载速度',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: downloadSpeeds,
        lineStyle: { color: '#00D4FF', width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(0, 212, 255, 0.4)' },
            { offset: 1, color: 'rgba(0, 212, 255, 0.02)' },
          ]),
        },
      },
      {
        name: '上传速度',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: uploadSpeeds,
        lineStyle: { color: '#7C3AED', width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(124, 58, 237, 0.4)' },
            { offset: 1, color: 'rgba(124, 58, 237, 0.02)' },
          ]),
        },
      },
    ],
    animationDuration: 500,
  }

  chartInstance.setOption(option)
}

watch(() => props.records, () => {
  updateChart()
}, { deep: true })

onMounted(() => {
  initChart()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
})
</script>

<template>
  <div
    ref="chartRef"
    class="w-full rounded-lg bg-bg-800/50 border border-bg-600"
    :style="{ height: height || '300px' }"
  ></div>
</template>
