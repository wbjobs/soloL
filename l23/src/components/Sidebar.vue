<script setup lang="ts">
import { Upload, Download, BarChart3 } from 'lucide-vue-next'
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()

const navItems = [
  { path: '/', label: '文件管理', icon: Upload },
  { path: '/download', label: 'P2P下载', icon: Download },
  { path: '/stats', label: '数据统计', icon: BarChart3 },
]

const isActive = (path: string) => {
  return route.path === path
}
</script>

<template>
  <aside class="w-64 bg-bg-800 border-r border-bg-600 flex flex-col h-full">
    <div class="p-6 border-b border-bg-600">
      <h1 class="text-2xl font-bold bg-gradient-to-r from-neon-blue to-neon-purple bg-clip-text text-transparent">
        Torrent Hub
      </h1>
      <p class="text-sm text-gray-400 mt-1">P2P文件分发平台</p>
    </div>

    <nav class="flex-1 p-4 space-y-2">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300"
        :class="[
          isActive(item.path)
            ? 'bg-gradient-to-r from-neon-blue/20 to-neon-purple/20 text-white border border-neon-blue/30 shadow-neon-blue'
            : 'text-gray-400 hover:bg-bg-700 hover:text-white'
        ]"
      >
        <component :is="item.icon" class="w-5 h-5" />
        <span class="font-medium">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div class="p-4 border-t border-bg-600">
      <div class="flex items-center gap-2 text-sm text-gray-400">
        <div class="led-dot online"></div>
        <span>Tracker: 在线</span>
      </div>
      <div class="flex items-center gap-2 text-sm text-gray-400 mt-2">
        <div class="led-dot online"></div>
        <span>Redis: 已连接</span>
      </div>
    </div>
  </aside>
</template>
