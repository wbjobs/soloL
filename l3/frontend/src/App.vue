<template>
  <div class="app-container">
    <header class="app-header">
      <div class="header-content">
        <div class="logo-section">
          <el-icon :size="32" color="#409eff"><DataLine /></el-icon>
          <h1 class="app-title">基因序列比对可视化系统</h1>
        </div>
        <nav class="app-nav">
          <router-link to="/" class="nav-link">
            <el-icon><Upload /></el-icon>
            <span>文件上传</span>
          </router-link>
          <router-link to="/tasks" class="nav-link">
            <el-icon><List /></el-icon>
            <span>比对任务</span>
          </router-link>
          <router-link to="/visualization" class="nav-link">
            <el-icon><Cpu /></el-icon>
            <span>3D可视化</span>
          </router-link>
        </nav>
      </div>
    </header>
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { DataLine, Upload, List, Cpu } from '@element-plus/icons-vue'
</script>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.app-header {
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0 30px;
  flex-shrink: 0;
}

.header-content {
  max-width: 1800px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 70px;
}

.logo-section {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-title {
  font-size: 22px;
  font-weight: 600;
  background: linear-gradient(90deg, #409eff, #67c23a);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.app-nav {
  display: flex;
  gap: 8px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  color: rgba(255, 255, 255, 0.7);
  text-decoration: none;
  border-radius: 8px;
  transition: all 0.3s ease;
  font-size: 14px;
}

.nav-link:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.nav-link.router-link-active {
  background: linear-gradient(135deg, #409eff, #667eea);
  color: #ffffff;
  box-shadow: 0 4px 15px rgba(64, 158, 255, 0.4);
}

.app-main {
  flex: 1;
  overflow: auto;
  padding: 30px;
}
</style>
