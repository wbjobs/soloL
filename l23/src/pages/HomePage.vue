<script setup lang="ts">
import FileUpload from '@/components/FileUpload.vue'
import FileList from '@/components/FileList.vue'
</script>

<template>
  <div class="p-8 space-y-8">
    <div>
      <h1 class="text-3xl font-bold text-white mb-2">文件管理</h1>
      <p class="text-gray-400">上传文件并生成P2P种子，支持分块SHA-256校验</p>
    </div>

    <FileUpload />
    <FileList />
  </div>
</template>
