<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  LayoutDashboard, FileText, FolderOpen, Network,
  GitBranch, Search, Menu, X, Scale, ChevronRight
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const sidebarCollapsed = ref(false)
const mobileMenuOpen = ref(false)

const navItems = [
  { path: '/', name: 'home', label: '系统首页', icon: LayoutDashboard },
  { path: '/case/input', name: 'case-input', label: '案件输入', icon: FileText },
  { path: '/case/list', name: 'case-list', label: '案件管理', icon: FolderOpen },
  { path: '/graph', name: 'graph', label: '知识图谱', icon: Network },
  { path: '/reasoning', name: 'reasoning', label: '反事实推理', icon: GitBranch },
  { path: '/search', name: 'search', label: '法律检索', icon: Search },
]

const currentTitle = computed(() => {
  const item = navItems.find(n => n.path === route.path)
  return item?.label || '法律辅助系统'
})

function navigateTo(path: string) {
  router.push(path)
  mobileMenuOpen.value = false
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-gray-50">
    <!-- Desktop Sidebar -->
    <aside
      class="hidden lg:flex flex-col bg-legal-navy text-gray-100 transition-all duration-300"
      :class="sidebarCollapsed ? 'w-16' : 'w-60'"
    >
      <div class="flex items-center h-16 px-4 border-b border-gray-700">
        <Scale class="w-7 h-7 text-accent-400 flex-shrink-0" />
        <span v-if="!sidebarCollapsed" class="ml-3 font-serif text-lg font-semibold text-accent-400 whitespace-nowrap">
          法律辅助系统
        </span>
      </div>

      <nav class="flex-1 py-4 space-y-1 overflow-y-auto">
        <button
          v-for="item in navItems"
          :key="item.path"
          @click="navigateTo(item.path)"
          class="w-full flex items-center px-4 py-3 text-sm transition-colors duration-200"
          :class="[
            route.path === item.path
              ? 'bg-blue-800/50 text-accent-400 border-r-2 border-accent-400'
              : 'text-gray-300 hover:bg-gray-700/50 hover:text-white'
          ]"
        >
          <component :is="item.icon" class="w-5 h-5 flex-shrink-0" />
          <span v-if="!sidebarCollapsed" class="ml-3 whitespace-nowrap">{{ item.label }}</span>
        </button>
      </nav>

      <div class="p-4 border-t border-gray-700">
        <button
          @click="sidebarCollapsed = !sidebarCollapsed"
          class="w-full flex items-center justify-center py-2 text-gray-400 hover:text-white transition-colors"
        >
          <ChevronRight class="w-4 h-4 transition-transform" :class="{ 'rotate-180': !sidebarCollapsed }" />
        </button>
      </div>
    </aside>

    <!-- Mobile Menu Overlay -->
    <div
      v-if="mobileMenuOpen"
      class="lg:hidden fixed inset-0 z-50 bg-black/50"
      @click="mobileMenuOpen = false"
    >
      <aside class="w-64 h-full bg-legal-navy text-gray-100 shadow-xl" @click.stop>
        <div class="flex items-center justify-between h-16 px-4 border-b border-gray-700">
          <div class="flex items-center">
            <Scale class="w-7 h-7 text-accent-400" />
            <span class="ml-3 font-serif text-lg font-semibold text-accent-400">法律辅助系统</span>
          </div>
          <button @click="mobileMenuOpen = false" class="text-gray-400 hover:text-white">
            <X class="w-5 h-5" />
          </button>
        </div>
        <nav class="py-4 space-y-1">
          <button
            v-for="item in navItems"
            :key="item.path"
            @click="navigateTo(item.path)"
            class="w-full flex items-center px-4 py-3 text-sm"
            :class="[
              route.path === item.path
                ? 'bg-blue-800/50 text-accent-400'
                : 'text-gray-300 hover:bg-gray-700/50'
            ]"
          >
            <component :is="item.icon" class="w-5 h-5" />
            <span class="ml-3">{{ item.label }}</span>
          </button>
        </nav>
      </aside>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Header -->
      <header class="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6 shadow-sm">
        <div class="flex items-center gap-3">
          <button
            class="lg:hidden text-gray-600 hover:text-gray-900"
            @click="mobileMenuOpen = true"
          >
            <Menu class="w-5 h-5" />
          </button>
          <h1 class="text-base font-semibold text-gray-800 font-serif">{{ currentTitle }}</h1>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-gray-400 hidden sm:inline">多模态知识图谱驱动的反事实推理法律辅助系统</span>
        </div>
      </header>

      <!-- Page Content -->
      <main class="flex-1 overflow-y-auto p-4 lg:p-6">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>
