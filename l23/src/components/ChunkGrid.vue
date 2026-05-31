<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  chunks: ('pending' | 'downloading' | 'verified' | 'error')[]
  chunkSize?: number
}>()

const gridCols = computed(() => {
  const count = props.chunks.length
  if (count <= 0) return 10
  const cols = Math.min(Math.ceil(Math.sqrt(count)) + 2, 50)
  return cols
})
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between text-sm">
      <span class="text-gray-400">分块校验状态</span>
      <div class="flex items-center gap-4 text-xs">
        <span class="flex items-center gap-1">
          <span class="chunk-cell pending"></span> 等待中
        </span>
        <span class="flex items-center gap-1">
          <span class="chunk-cell downloading"></span> 下载中
        </span>
        <span class="flex items-center gap-1">
          <span class="chunk-cell verified"></span> 已校验
        </span>
        <span class="flex items-center gap-1">
          <span class="chunk-cell error"></span> 错误
        </span>
      </div>
    </div>
    <div
      class="p-4 bg-bg-900 rounded-lg grid gap-1"
      :style="{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }"
    >
      <div
        v-for="(status, idx) in chunks"
        :key="idx"
        class="chunk-cell"
        :class="status"
        :title="`分块 #${idx}: ${status}`"
      ></div>
    </div>
    <div class="flex justify-between text-xs text-gray-500">
      <span>共 {{ chunks.length }} 块 · 每块 {{ (chunkSize || 256) }} KB</span>
      <span>
        已校验: {{ chunks.filter(c => c === 'verified').length }} / {{ chunks.length }}
      </span>
    </div>
  </div>
</template>
