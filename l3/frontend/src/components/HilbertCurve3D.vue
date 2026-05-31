<template>
  <div class="hilbert-container">
    <div ref="containerRef" class="canvas-container"></div>
    <div class="controls-panel">
      <div class="control-group">
        <label>
          <el-checkbox v-model="showCurve" />
          显示曲线
        </label>
        <label>
          <el-checkbox v-model="showPoints" />
          显示热图点
        </label>
        <label>
          <el-checkbox v-model="showMarkers" />
          显示差异位点
        </label>
      </div>
      <div class="control-group">
        <label>曲线粗细</label>
        <el-slider v-model="curveWidth" :min="0.1" :max="2" :step="0.1" />
      </div>
      <div class="control-group">
        <label>点大小</label>
        <el-slider v-model="pointSize" :min="0.05" :max="0.5" :step="0.05" />
      </div>
      <div class="control-group">
        <label>差异标记大小</label>
        <el-slider v-model="markerSize" :min="0.1" :max="1" :step="0.1" />
      </div>
      <div class="control-group">
        <label>
          <el-checkbox v-model="regionSelectMode" />
          区域选择模式
        </label>
        <el-button 
          :type="regionSelectMode ? 'warning' : 'primary'" 
          size="small" 
          @click="toggleRegionSelect"
        >
          {{ regionSelectMode ? '退出选择' : '圈选区域' }}
        </el-button>
      </div>
      <div class="control-group">
        <el-button type="primary" size="small" @click="resetCamera">
          重置视角
        </el-button>
        <el-button type="success" size="small" @click="toggleAutoRotate">
          {{ autoRotate ? '停止旋转' : '自动旋转' }}
        </el-button>
      </div>
      <div class="control-group" v-if="selectedRegion">
        <label>已选区域</label>
        <div class="selected-info">
          <div class="info-line">
            <span>位置:</span>
            <span>{{ selectedRegion.start }} - {{ selectedRegion.end }}</span>
          </div>
          <div class="info-line">
            <span>长度:</span>
            <span>{{ formatNumber(selectedRegion.length) }} bp</span>
          </div>
          <div class="info-line">
            <span>包含点:</span>
            <span>{{ selectedRegion.pointCount }} 个</span>
          </div>
        </div>
        <div class="action-buttons">
          <el-button type="primary" size="small" @click="analyzeRegion">
            高精度分析
          </el-button>
          <el-button size="small" @click="clearSelection">
            清除选择
          </el-button>
        </div>
      </div>
    </div>

    <div class="legend-panel">
      <h4>相似度热图图例</h4>
      <div class="legend-gradient"></div>
      <div class="legend-labels">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
      <div class="legend-info" v-if="hoveredPoint">
        <div class="info-item">
          <span class="label">序列位置:</span>
          <span class="value">{{ hoveredPoint.sequence_index }}</span>
        </div>
        <div class="info-item">
          <span class="label">相似度:</span>
          <span class="value" :style="{ color: hoveredPoint.color }">
            {{ hoveredPoint.similarity.toFixed(1) }}%
          </span>
        </div>
        <div class="info-item">
          <span class="label">匹配数:</span>
          <span class="value">{{ hoveredPoint.match_count }}</span>
        </div>
        <div class="info-item">
          <span class="label">空位:</span>
          <span class="value">{{ hoveredPoint.gap_count }}</span>
        </div>
      </div>
    </div>

    <div class="stats-panel" v-if="stats">
      <div class="stat-item">
        <span class="stat-label">比对长度</span>
        <span class="stat-value">{{ formatNumber(stats.alignment_length) }} bp</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">一致性</span>
        <span class="stat-value success">{{ stats.identity_percentage.toFixed(2) }}%</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">匹配</span>
        <span class="stat-value success">{{ formatNumber(stats.match_count) }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">错配</span>
        <span class="stat-value warning">{{ formatNumber(stats.mismatch_count) }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">空位</span>
        <span class="stat-value danger">{{ formatNumber(stats.gap_count) }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">差异位点</span>
        <span class="stat-value danger">{{ formatNumber(stats.difference_count) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const props = defineProps({
  hilbertData: {
    type: Array,
    default: () => []
  },
  differenceSites: {
    type: Array,
    default: () => []
  },
  stats: {
    type: Object,
    default: null
  },
  taskId: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['region-selected', 'analyze-region', 'export-request'])

const containerRef = ref(null)

const showCurve = ref(true)
const showPoints = ref(true)
const showMarkers = ref(true)
const curveWidth = ref(0.5)
const pointSize = ref(0.15)
const markerSize = ref(0.3)
const autoRotate = ref(false)
const hoveredPoint = ref(null)
const regionSelectMode = ref(false)
const selectedRegion = ref(null)

let scene, camera, renderer, controls
let curveLine = null
let pointsMesh = null
let markersGroup = null
let raycaster, mouse
let animationFrameId = null
let selectionSphere = null
let isSelecting = false
let selectionStartPoint = null
let selectionEndPoint = null
let selectedPointsIndices = []

function formatNumber(num) {
  return num ? num.toLocaleString() : '0'
}

function initScene() {
  if (!containerRef.value) return

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0a0a1a)
  scene.fog = new THREE.Fog(0x0a0a1a, 20, 50)

  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
  camera.position.set(15, 12, 15)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  containerRef.value.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.minDistance = 5
  controls.maxDistance = 50

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(10, 20, 10)
  directionalLight.castShadow = true
  scene.add(directionalLight)

  const pointLight1 = new THREE.PointLight(0x409eff, 0.5, 30)
  pointLight1.position.set(-10, 10, -10)
  scene.add(pointLight1)

  const pointLight2 = new THREE.PointLight(0x67c23a, 0.3, 30)
  pointLight2.position.set(10, -5, 10)
  scene.add(pointLight2)

  const gridHelper = new THREE.GridHelper(30, 30, 0x333355, 0x222244)
  gridHelper.position.y = -6
  scene.add(gridHelper)

  const axesHelper = new THREE.AxesHelper(5)
  scene.add(axesHelper)

  raycaster = new THREE.Raycaster()
  mouse = new THREE.Vector2()

  renderer.domElement.addEventListener('mousemove', onMouseMove)
  renderer.domElement.addEventListener('mousedown', onMouseDown)
  renderer.domElement.addEventListener('mouseup', onMouseUp)
  renderer.domElement.addEventListener('wheel', onMouseWheel)

  animate()
}

function onMouseMove(event) {
  if (!containerRef.value || !pointsMesh) return

  const rect = containerRef.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  if (regionSelectMode.value && isSelecting && selectionStartPoint) {
    raycaster.setFromCamera(mouse, camera)
    const intersects = raycaster.intersectObject(pointsMesh)

    if (intersects.length > 0) {
      const point = intersects[0].point
      selectionEndPoint = point.clone()
      updateSelectionSphere()
    }

    updateSelectedPoints()
    return
  }

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObject(pointsMesh)

  if (intersects.length > 0) {
    const pointIndex = intersects[0].index
    if (pointIndex !== undefined && props.hilbertData[pointIndex]) {
      hoveredPoint.value = {
        sequence_index: props.hilbertData[pointIndex].sequence_index,
        similarity: props.hilbertData[pointIndex].similarity,
        color: props.hilbertData[pointIndex].color,
        match_count: props.hilbertData[pointIndex].match_count,
        gap_count: props.hilbertData[pointIndex].gap_count
      }
      renderer.domElement.style.cursor = regionSelectMode.value ? 'crosshair' : 'pointer'
    }
  } else {
    hoveredPoint.value = null
    renderer.domElement.style.cursor = regionSelectMode.value ? 'crosshair' : 'default'
  }
}

function onMouseDown(event) {
  if (!regionSelectMode.value || event.button !== 0) return
  if (!containerRef.value || !pointsMesh) return

  const rect = containerRef.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObject(pointsMesh)

  if (intersects.length > 0) {
    isSelecting = true
    selectionStartPoint = intersects[0].point.clone()
    selectionEndPoint = selectionStartPoint.clone()
    controls.enabled = false
    createSelectionSphere()
  }
}

function onMouseUp(event) {
  if (!regionSelectMode.value || !isSelecting) return

  isSelecting = false
  controls.enabled = true

  if (selectionStartPoint && selectionEndPoint) {
    finalizeSelection()
  }
}

function onMouseWheel() {
  if (regionSelectMode.value && isSelecting) {
    event.preventDefault()
  }
}

function createSelectionSphere() {
  if (selectionSphere) {
    scene.remove(selectionSphere)
    selectionSphere.geometry.dispose()
    selectionSphere.material.dispose()
  }

  const geometry = new THREE.SphereGeometry(0.1, 32, 32)
  const material = new THREE.MeshBasicMaterial({
    color: 0x409eff,
    transparent: true,
    opacity: 0.3,
    wireframe: true,
    wireframeLinewidth: 2
  })

  selectionSphere = new THREE.Mesh(geometry, material)
  selectionSphere.position.copy(selectionStartPoint)
  scene.add(selectionSphere)
}

function updateSelectionSphere() {
  if (!selectionSphere || !selectionStartPoint || !selectionEndPoint) return

  const center = new THREE.Vector3().addVectors(
    selectionStartPoint,
    selectionEndPoint
  ).multiplyScalar(0.5)
  const radius = selectionStartPoint.distanceTo(selectionEndPoint) / 2

  selectionSphere.position.copy(center)
  selectionSphere.scale.setScalar(radius * 2)
}

function updateSelectedPoints() {
  if (!selectionSphere || !pointsMesh || !props.hilbertData.length) return

  const center = selectionSphere.position
  const radius = selectionStartPoint.distanceTo(selectionEndPoint) / 2

  selectedPointsIndices = []
  const positions = pointsMesh.geometry.attributes.position.array

  for (let i = 0; i < props.hilbertData.length; i++) {
    const px = positions[i * 3]
    const py = positions[i * 3 + 1]
    const pz = positions[i * 3 + 2]

    const dist = Math.sqrt(
      Math.pow(px - center.x, 2) +
      Math.pow(py - center.y, 2) +
      Math.pow(pz - center.z, 2)
    )

    if (dist <= radius) {
      selectedPointsIndices.push(i)
    }
  }

  highlightSelectedPoints()
}

function highlightSelectedPoints() {
  if (!pointsMesh || !props.hilbertData.length) return

  const colors = pointsMesh.geometry.attributes.color.array

  for (let i = 0; i < props.hilbertData.length; i++) {
    const point = props.hilbertData[i]
    const rgb = point.color_rgb || [128, 128, 128]

    if (selectedPointsIndices.includes(i)) {
      colors[i * 3] = 1.0
      colors[i * 3 + 1] = 1.0
      colors[i * 3 + 2] = 0.0
    } else {
      colors[i * 3] = rgb[0] / 255
      colors[i * 3 + 1] = rgb[1] / 255
      colors[i * 3 + 2] = rgb[2] / 255
    }
  }

  pointsMesh.geometry.attributes.color.needsUpdate = true
}

function finalizeSelection() {
  if (selectedPointsIndices.length === 0) {
    clearSelection()
    return
  }

  const minIndex = Math.min(...selectedPointsIndices)
  const maxIndex = Math.max(...selectedPointsIndices)

  const startPoint = props.hilbertData[minIndex]
  const endPoint = props.hilbertData[maxIndex]

  const startPos = Math.min(startPoint.sequence_index, endPoint.sequence_index)
  const endPos = Math.max(startPoint.sequence_index, endPoint.sequence_index)

  const center = selectionSphere.position
  const radius = selectionStartPoint.distanceTo(selectionEndPoint) / 2

  selectedRegion.value = {
    start: startPos,
    end: endPos,
    length: endPos - startPos,
    pointCount: selectedPointsIndices.length,
    center: { x: center.x, y: center.y, z: center.z },
    radius: radius,
    hilbertIndices: [...selectedPointsIndices]
  }

  if (selectionSphere) {
    selectionSphere.material.color.setHex(0xffd700)
    selectionSphere.material.opacity = 0.5
  }

  emit('region-selected', selectedRegion.value)
}

function clearSelection() {
  selectedRegion.value = null
  selectedPointsIndices = []
  selectionStartPoint = null
  selectionEndPoint = null

  if (selectionSphere) {
    scene.remove(selectionSphere)
    selectionSphere.geometry.dispose()
    selectionSphere.material.dispose()
    selectionSphere = null
  }

  if (pointsMesh && props.hilbertData.length > 0) {
    createPoints(props.hilbertData)
  }
}

function toggleRegionSelect() {
  regionSelectMode.value = !regionSelectMode.value
  if (!regionSelectMode.value) {
    clearSelection()
    controls.enabled = true
  } else {
    controls.enabled = !isSelecting
  }
}

function analyzeRegion() {
  if (!selectedRegion.value) return
  emit('analyze-region', selectedRegion.value)
}

function createCurve(data) {
  if (curveLine) {
    scene.remove(curveLine)
    curveLine.geometry.dispose()
    curveLine.material.dispose()
  }

  if (!data || data.length < 2) return

  const points = []
  const colors = []

  for (let i = 0; i < data.length; i++) {
    const point = data[i]
    points.push(new THREE.Vector3(point.x - 5, point.y - 5, point.z - 5))

    const rgb = point.color_rgb || [128, 128, 128]
    colors.push(new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255))
  }

  const curve = new THREE.CatmullRomCurve3(points)
  const curvePoints = curve.getPoints(data.length * 2)

  const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints)

  const curveColors = []
  for (let i = 0; i < curvePoints.length; i++) {
    const dataIndex = Math.min(Math.floor(i / 2), colors.length - 1)
    const color = colors[dataIndex]
    curveColors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(curveColors, 3))

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    linewidth: curveWidth.value,
    transparent: true,
    opacity: 0.8
  })

  curveLine = new THREE.Line(geometry, material)
  scene.add(curveLine)
}

function createPoints(data) {
  if (pointsMesh) {
    scene.remove(pointsMesh)
    pointsMesh.geometry.dispose()
    pointsMesh.material.dispose()
  }

  if (!data || data.length === 0) return

  const positions = []
  const colors = []

  for (let i = 0; i < data.length; i++) {
    const point = data[i]
    positions.push(point.x - 5, point.y - 5, point.z - 5)

    const rgb = point.color_rgb || [128, 128, 128]
    colors.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: pointSize.value,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: true
  })

  pointsMesh = new THREE.Points(geometry, material)
  scene.add(pointsMesh)
}

function createMarkers(differences, hilbertData) {
  if (markersGroup) {
    scene.remove(markersGroup)
    markersGroup.children.forEach(child => {
      child.geometry.dispose()
      child.material.dispose()
    })
  }

  markersGroup = new THREE.Group()

  if (!differences || differences.length === 0 || !hilbertData || hilbertData.length === 0) {
    scene.add(markersGroup)
    return
  }

  const stepSize = hilbertData.length > 0 ? (hilbertData[1]?.sequence_index - hilbertData[0]?.sequence_index || 10) : 10
  const windowSize = 50

  const differencePositions = new Map()

  differences.forEach(diff => {
    const windowIndex = Math.floor(diff.position / stepSize)
    if (!differencePositions.has(windowIndex)) {
      differencePositions.set(windowIndex, [])
    }
    differencePositions.get(windowIndex).push(diff)
  })

  const markerGeometry = new THREE.SphereGeometry(markerSize.value, 16, 16)
  const mismatchMaterial = new THREE.MeshPhongMaterial({
    color: 0xff3333,
    emissive: 0xff0000,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.9
  })
  const gapMaterial = new THREE.MeshPhongMaterial({
    color: 0xff8800,
    emissive: 0xff4400,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.9
  })

  differencePositions.forEach((diffs, windowIndex) => {
    const dataPoint = hilbertData[windowIndex]
    if (!dataPoint) return

    const hasMismatch = diffs.some(d => d.type === 'mismatch')
    const hasGap = diffs.some(d => d.type === 'gap')

    const material = hasMismatch ? mismatchMaterial : gapMaterial

    const marker = new THREE.Mesh(markerGeometry, material)
    marker.position.set(
      dataPoint.x - 5,
      dataPoint.y - 5,
      dataPoint.z - 5
    )
    marker.userData = {
      type: hasMismatch ? 'mismatch' : 'gap',
      count: diffs.length,
      differences: diffs
    }

    const scale = Math.min(1 + diffs.length * 0.2, 3)
    marker.scale.set(scale, scale, scale)

    markersGroup.add(marker)
  })

  scene.add(markersGroup)
}

function animate() {
  animationFrameId = requestAnimationFrame(animate)

  if (autoRotate.value && controls) {
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.5
  } else if (controls) {
    controls.autoRotate = false
  }

  controls.update()
  renderer.render(scene, camera)
}

function resetCamera() {
  camera.position.set(15, 12, 15)
  controls.reset()
}

function toggleAutoRotate() {
  autoRotate.value = !autoRotate.value
}

function onWindowResize() {
  if (!containerRef.value || !camera || !renderer) return

  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight

  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

watch(() => props.hilbertData, (newData) => {
  if (showCurve.value) {
    createCurve(newData)
  }
  if (showPoints.value) {
    createPoints(newData)
  }
  if (showMarkers.value && props.differenceSites) {
    createMarkers(props.differenceSites, newData)
  }
}, { deep: true })

watch(() => props.differenceSites, (newDiffs) => {
  if (showMarkers.value && props.hilbertData) {
    createMarkers(newDiffs, props.hilbertData)
  }
}, { deep: true })

watch(showCurve, (val) => {
  if (curveLine) {
    curveLine.visible = val
  }
  if (val && props.hilbertData.length > 0) {
    createCurve(props.hilbertData)
  }
})

watch(showPoints, (val) => {
  if (pointsMesh) {
    pointsMesh.visible = val
  }
  if (val && props.hilbertData.length > 0) {
    createPoints(props.hilbertData)
  }
})

watch(showMarkers, (val) => {
  if (markersGroup) {
    markersGroup.visible = val
  }
  if (val && props.differenceSites.length > 0 && props.hilbertData.length > 0) {
    createMarkers(props.differenceSites, props.hilbertData)
  }
})

watch(curveWidth, () => {
  if (curveLine && props.hilbertData.length > 0) {
    createCurve(props.hilbertData)
  }
})

watch(pointSize, () => {
  if (pointsMesh && props.hilbertData.length > 0) {
    createPoints(props.hilbertData)
  }
})

watch(markerSize, () => {
  if (props.differenceSites.length > 0 && props.hilbertData.length > 0) {
    createMarkers(props.differenceSites, props.hilbertData)
  }
})

onMounted(() => {
  initScene()
  window.addEventListener('resize', onWindowResize)
})

onUnmounted(() => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
  }
  window.removeEventListener('resize', onWindowResize)
  if (renderer && renderer.domElement) {
    renderer.domElement.removeEventListener('mousemove', onMouseMove)
    renderer.domElement.removeEventListener('mousedown', onMouseDown)
    renderer.domElement.removeEventListener('mouseup', onMouseUp)
    renderer.domElement.removeEventListener('wheel', onMouseWheel)
  }
  if (selectionSphere) {
    selectionSphere.geometry.dispose()
    selectionSphere.material.dispose()
  }
  if (renderer) {
    renderer.dispose()
  }
})
</script>

<style scoped>
.hilbert-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.canvas-container {
  width: 100%;
  height: 100%;
  border-radius: 16px;
  overflow: hidden;
}

.controls-panel {
  position: absolute;
  top: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
  min-width: 220px;
  z-index: 10;
}

.control-group {
  margin-bottom: 16px;
}

.control-group:last-child {
  margin-bottom: 0;
  display: flex;
  gap: 10px;
}

.control-group label {
  display: block;
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  margin-bottom: 8px;
}

.control-group label:has(input[type="checkbox"]) {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  cursor: pointer;
}

.legend-panel {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
  min-width: 200px;
  z-index: 10;
}

.legend-panel h4 {
  margin: 0 0 12px 0;
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
}

.legend-gradient {
  height: 20px;
  border-radius: 4px;
  background: linear-gradient(to right,
    rgb(200, 0, 0) 0%,
    rgb(200, 100, 0) 30%,
    rgb(200, 200, 0) 50%,
    rgb(100, 200, 0) 70%,
    rgb(0, 200, 0) 100%
  );
}

.legend-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.legend-info {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.legend-info .info-item {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}

.legend-info .label {
  color: rgba(255, 255, 255, 0.6);
}

.legend-info .value {
  color: #ffffff;
  font-weight: 500;
}

.stats-panel {
  position: absolute;
  bottom: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  gap: 24px;
  z-index: 10;
}

.stat-item {
  text-align: center;
}

.stat-label {
  display: block;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 4px;
}

.stat-value {
  display: block;
  font-size: 18px;
  font-weight: 600;
  color: #ffffff;
}

.stat-value.success {
  color: #67c23a;
}

.stat-value.warning {
  color: #e6a23c;
}

.stat-value.danger {
  color: #f56c6c;
}

.selected-info {
  background: rgba(64, 158, 255, 0.1);
  border: 1px solid rgba(64, 158, 255, 0.3);
  border-radius: 8px;
  padding: 12px;
  margin-top: 8px;
}

.selected-info .info-line {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}

.selected-info .info-line span:last-child {
  color: #409eff;
  font-weight: 500;
}

.action-buttons {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.action-buttons .el-button {
  flex: 1;
}

.control-group:has(.selected-info) {
  padding-bottom: 0;
  margin-bottom: 12px;
}

.control-group .el-checkbox {
  margin-right: 12px;
}
</style>
