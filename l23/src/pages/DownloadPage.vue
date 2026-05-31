<script setup lang="ts">
import DownloadPanel from '@/components/DownloadPanel.vue'
</script>

<template>
  <div class="p-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-white mb-2">P2P下载</h1>
      <p class="text-gray-400">使用WebTorrent协议进行点对点下载，多节点互传加速</p>
    </div>

    <DownloadPanel />
  </div>
</template>
