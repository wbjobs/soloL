import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import useStore from '../store/useStore'

const TRACK_COLORS = [
  0x6366f1, 0xa855f7, 0xec4899, 0x22c55e,
  0xf59e0b, 0x3b82f6, 0xef4444, 0x10b981,
  0x8b5cf6, 0xf97316, 0x06b6d4, 0x84cc16
]

function ThreeJSVisualizer() {
  const containerRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const controlsRef = useRef(null)
  const animationIdRef = useRef(null)
  const noteMeshesRef = useRef(new Map())
  const notePoolRef = useRef([])
  const frustumRef = useRef(new THREE.Frustum())
  const matrixRef = useRef(new THREE.Matrix4())
  const timeIndicatorRef = useRef(null)
  const annotationMeshesRef = useRef([])
  const lastUpdateRef = useRef(0)
  const lastCameraUpdateRef = useRef(0)
  
  const {
    selectedMidi,
    annotations,
    trackVisibility,
    timePosition,
    isPlaying,
    playbackSpeed,
    setTimePosition,
    setIsPlaying,
    remoteCursors,
    useFrustumCulling,
    dynamicLoading,
    updateViewport,
    getAllNotes,
    loadingNotes
  } = useStore()

  const [hoveredNote, setHoveredNote] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0, visible: false })
  const [stats, setStats] = useState({ visibleNotes: 0, totalNotes: 0, fps: 60 })

  const maxDuration = useMemo(() => {
    return selectedMidi?.total_duration || 100
  }, [selectedMidi])

  const maxPitch = 108
  const minPitch = 21
  const timeScale = 100 / maxDuration
  const pitchScale = 0.5

  const getNoteFromPool = useCallback(() => {
    if (notePoolRef.current.length > 0) {
      return notePoolRef.current.pop()
    }
    return null
  }, [])

  const returnNoteToPool = useCallback((mesh) => {
    if (mesh) {
      mesh.visible = false
      mesh.userData = {}
      notePoolRef.current.push(mesh)
    }
  }, [])

  const createNoteMesh = useCallback((note) => {
    const color = TRACK_COLORS[note.track % TRACK_COLORS.length]
    const height = (note.velocity / 127) * 3 + 0.5
    const x = note.start_time * timeScale
    const y = height / 2
    const z = (note.pitch - minPitch) * pitchScale
    const width = Math.max(note.duration * timeScale, 0.1)
    const depth = pitchScale * 0.8

    const geometry = new THREE.BoxGeometry(width, height, depth)
    const material = new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.3,
      roughness: 0.4,
      transparent: true,
      opacity: 0.9
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x + width / 2, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData = note
    mesh.frustumCulled = false

    return mesh
  }, [timeScale, pitchScale, minPitch])

  const updateNoteVisibility = useCallback(() => {
    if (!cameraRef.current || !useFrustumCulling) {
      noteMeshesRef.current.forEach(mesh => {
        if (mesh) mesh.visible = true
      })
      return
    }

    cameraRef.current.updateMatrixWorld()
    cameraRef.current.updateProjectionMatrix()
    
    matrixRef.current.multiplyMatrices(
      cameraRef.current.projectionMatrix,
      cameraRef.current.matrixWorldInverse
    )
    frustumRef.current.setFromProjectionMatrix(matrixRef.current)

    const notes = getAllNotes()
    let visibleCount = 0

    notes.forEach((note) => {
      if (!trackVisibility[note.track]) return
      
      const mesh = noteMeshesRef.current.get(note.id)
      if (!mesh) return

      const x = note.start_time * timeScale
      const width = Math.max(note.duration * timeScale, 0.1)
      const z = (note.pitch - minPitch) * pitchScale
      const height = (note.velocity / 127) * 3 + 0.5

      const boundingSphere = new THREE.Sphere(
        new THREE.Vector3(x + width / 2, height / 2, z),
        Math.max(width, height, pitchScale * 0.8) / 2 + 0.5
      )

      const isVisible = frustumRef.current.intersectsSphere(boundingSphere)
      mesh.visible = isVisible
      if (isVisible) visibleCount++
    })

    setStats(prev => ({ ...prev, visibleNotes: visibleCount, totalNotes: notes.length }))
  }, [getAllNotes, trackVisibility, useFrustumCulling, timeScale, pitchScale, minPitch])

  const updateNoteMeshes = useCallback(() => {
    const notes = getAllNotes()
    const currentIds = new Set()

    notes.forEach((note) => {
      if (!trackVisibility[note.track]) return
      
      currentIds.add(note.id)
      
      if (!noteMeshesRef.current.has(note.id)) {
        const mesh = createNoteMesh(note)
        if (sceneRef.current) {
          sceneRef.current.add(mesh)
        }
        noteMeshesRef.current.set(note.id, mesh)
      }
    })

    noteMeshesRef.current.forEach((mesh, id) => {
      if (!currentIds.has(id) || !trackVisibility[mesh.userData?.track]) {
        if (sceneRef.current && mesh) {
          sceneRef.current.remove(mesh)
        }
        if (mesh) {
          mesh.geometry?.dispose()
          mesh.material?.dispose()
        }
        noteMeshesRef.current.delete(id)
      }
    })
  }, [getAllNotes, trackVisibility, createNoteMesh])

  const onCameraChange = useCallback(() => {
    const now = Date.now()
    if (now - lastCameraUpdateRef.current < 100) return
    lastCameraUpdateRef.current = now

    updateNoteVisibility()

    if (!dynamicLoading || !selectedMidi) return

    if (cameraRef.current) {
      const target = controlsRef.current?.target || new THREE.Vector3(50, 0, 0)
      const viewRange = 50 / cameraRef.current.position.distanceTo(target) * 20
      const startTime = Math.max(0, (target.x - viewRange) / timeScale)
      const endTime = Math.min(maxDuration, (target.x + viewRange) / timeScale)
      
      updateViewport(startTime, endTime)
    }
  }, [dynamicLoading, selectedMidi, updateNoteVisibility, updateViewport, timeScale, maxDuration])

  useEffect(() => {
    if (!containerRef.current || !selectedMidi) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a1a)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      2000
    )
    camera.position.set(50, 80, 100)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.target.set(50, 0, 0)
    controls.addEventListener('change', onCameraChange)
    controlsRef.current = controls

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(50, 100, 50)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    scene.add(directionalLight)

    const pointLight1 = new THREE.PointLight(0x6366f1, 0.5, 200)
    pointLight1.position.set(0, 50, 50)
    scene.add(pointLight1)

    const pointLight2 = new THREE.PointLight(0xa855f7, 0.5, 200)
    pointLight2.position.set(100, 50, -50)
    scene.add(pointLight2)

    const gridHelper = new THREE.GridHelper(200, 100, 0x2a2a5a, 0x1a1a3a)
    gridHelper.position.set(50, 0, 0)
    scene.add(gridHelper)

    const timeIndicatorGeom = new THREE.PlaneGeometry(0.1, 50)
    const timeIndicatorMat = new THREE.MeshBasicMaterial({
      color: 0xec4899,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    })
    const timeIndicator = new THREE.Mesh(timeIndicatorGeom, timeIndicatorMat)
    timeIndicator.rotation.x = -Math.PI / 2
    timeIndicator.position.set(0, 0.02, 0)
    scene.add(timeIndicator)
    timeIndicatorRef.current = timeIndicator

    let lastFrameTime = performance.now()
    let frameCount = 0
    let fpsTimer = 0

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)
      controls.update()

      frameCount++
      const now = performance.now()
      fpsTimer += now - lastFrameTime
      lastFrameTime = now

      if (fpsTimer >= 1000) {
        setStats(prev => ({ ...prev, fps: frameCount }))
        frameCount = 0
        fpsTimer = 0
      }

      if (isPlaying) {
        setTimePosition(prev => {
          const newTime = prev + 0.016 * playbackSpeed
          if (newTime >= maxDuration) {
            setIsPlaying(false)
            return 0
          }
          return newTime
        })
      }

      if (timeIndicatorRef.current) {
        const xPos = timePosition * timeScale
        timeIndicatorRef.current.position.x = xPos
      }

      const updateNow = Date.now()
      if (updateNow - lastUpdateRef.current > 500) {
        updateNoteVisibility()
        lastUpdateRef.current = updateNow
      }

      renderer.render(scene, camera)
    }
    animate()

    const handleResize = () => {
      if (!containerRef.current) return
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      controls.removeEventListener('change', onCameraChange)
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current)
      }
      renderer.dispose()
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement)
      }
      
      noteMeshesRef.current.forEach((mesh) => {
        mesh?.geometry?.dispose()
        mesh?.material?.dispose()
      })
      noteMeshesRef.current.clear()
    }
  }, [selectedMidi, maxDuration, timePosition, isPlaying, playbackSpeed, 
      onCameraChange, updateNoteVisibility, setTimePosition, setIsPlaying, timeScale])

  useEffect(() => {
    if (!sceneRef.current) return
    
    const now = Date.now()
    if (now - lastUpdateRef.current < 100) return
    
    updateNoteMeshes()
    updateNoteVisibility()
    lastUpdateRef.current = now
  }, [selectedMidi?.notes, trackVisibility, updateNoteMeshes, updateNoteVisibility])

  useEffect(() => {
    if (!sceneRef.current) return

    annotationMeshesRef.current.forEach(mesh => {
      sceneRef.current.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    })
    annotationMeshesRef.current = []

    annotations.forEach((annot) => {
      const x1 = annot.start_time * timeScale
      const x2 = annot.end_time * timeScale
      const width = x2 - x1

      let color = 0x6366f1
      if (annot.type === 'chord') color = 0x22c55e
      else if (annot.type === 'melody') color = 0xf59e0b
      else if (annot.type === 'rhythm') color = 0xec4899

      const geometry = new THREE.BoxGeometry(width, 0.05, (maxPitch - minPitch) * pitchScale)
      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.3
      })

      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(
        x1 + width / 2,
        0.03,
        ((maxPitch - minPitch) / 2) * pitchScale
      )
      mesh.userData = annot

      sceneRef.current.add(mesh)
      annotationMeshesRef.current.push(mesh)
    })
  }, [annotations, timeScale, pitchScale, maxPitch, minPitch, selectedMidi])

  useEffect(() => {
    if (noteMeshesRef.current && rendererRef.current && containerRef.current) {
      const raycaster = new THREE.Raycaster()
      const mouse = new THREE.Vector2()
      let isDragging = false

      const onMouseMove = (event) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        if (isDragging) {
          const x = (mouse.x + 1) / 2 * 100
          const newTime = x / timeScale
          setTimePosition(Math.max(0, Math.min(newTime, maxDuration)))
          return
        }

        raycaster.setFromCamera(mouse, cameraRef.current)
        const meshes = Array.from(noteMeshesRef.current.values()).filter(m => m && m.visible)
        const intersects = raycaster.intersectObjects(meshes)

        if (intersects.length > 0) {
          setHoveredNote(intersects[0].object.userData)
          setTooltipPos({ x: event.clientX, y: event.clientY, visible: true })
          containerRef.current.style.cursor = 'pointer'
        } else {
          setHoveredNote(null)
          setTooltipPos(prev => ({ ...prev, visible: false }))
          containerRef.current.style.cursor = 'default'
        }
      }

      const onMouseDown = (event) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        raycaster.setFromCamera(mouse, cameraRef.current)
        const meshes = Array.from(noteMeshesRef.current.values()).filter(m => m && m.visible)
        const intersects = raycaster.intersectObjects(meshes)

        if (intersects.length === 0 && event.button === 0) {
          isDragging = true
        }
      }

      const onMouseUp = () => {
        isDragging = false
      }

      const domElement = rendererRef.current.domElement
      domElement.addEventListener('mousemove', onMouseMove)
      domElement.addEventListener('mousedown', onMouseDown)
      document.addEventListener('mouseup', onMouseUp)

      return () => {
        domElement.removeEventListener('mousemove', onMouseMove)
        domElement.removeEventListener('mousedown', onMouseDown)
        document.removeEventListener('mouseup', onMouseUp)
      }
    }
  }, [selectedMidi, maxDuration, timeScale, setTimePosition])

  if (!selectedMidi) {
    return (
      <div className="visualizer-container">
        <div className="empty-state">
          <div className="empty-state-icon">🎵</div>
          <div className="empty-state-text">选择一个 MIDI 文件</div>
          <div className="empty-state-subtext">加载后将显示三维音符可视化</div>
        </div>
      </div>
    )
  }

  return (
    <div className="visualizer-container">
      <div ref={containerRef} className="three-canvas" />
      
      {tooltipPos.visible && hoveredNote && (
        <div style={{
          position: 'fixed',
          left: tooltipPos.x + 12,
          top: tooltipPos.y + 12,
          background: 'rgba(18, 18, 42, 0.95)',
          border: '1px solid #3a3a6a',
          borderRadius: '6px',
          padding: '8px 12px',
          fontSize: '12px',
          pointerEvents: 'none',
          zIndex: 100
        }}>
          <div style={{ fontWeight: '500', marginBottom: '4px' }}>
            {hoveredNote.note_name}
          </div>
          <div style={{ color: '#8080c0', fontSize: '11px' }}>
            音高: {hoveredNote.pitch} | 力度: {hoveredNote.velocity}
          </div>
          <div style={{ color: '#8080c0', fontSize: '11px' }}>
            时间: {hoveredNote.start_time?.toFixed(2)}s - 
            时长: {hoveredNote.duration?.toFixed(2)}s
          </div>
          <div style={{ color: '#8080c0', fontSize: '11px' }}>
            轨道: {hoveredNote.track} | 通道: {hoveredNote.channel}
          </div>
        </div>
      )}

      <div className="track-info-panel">
        <h4>轨道信息</h4>
        {selectedMidi.tracks.map((track) => (
          <div key={track.id} className="track-item">
            <input
              type="checkbox"
              checked={trackVisibility[track.id]}
              onChange={() => useStore.getState().toggleTrackVisibility(track.id)}
            />
            <div
              className="track-color"
              style={{ backgroundColor: `#${TRACK_COLORS[track.id % TRACK_COLORS.length].toString(16).padStart(6, '0')}` }}
            />
            <span title={track.name}>
              {track.name} ({track.notes_count} 音符)
            </span>
          </div>
        ))}
      </div>

      <div className="controls-panel">
        <div className="control-row">
          <label>播放控制</label>
          <button
            className="btn btn-small"
            onClick={() => setIsPlaying(!isPlaying)}
            style={{ marginRight: '4px' }}
          >
            {isPlaying ? '⏸️' : '▶️'}
          </button>
          <button
            className="btn btn-small btn-secondary"
            onClick={() => setTimePosition(0)}
          >
            ⏮️
          </button>
        </div>
        <div className="control-row">
          <label>速度</label>
          <input
            type="range"
            min="0.25"
            max="4"
            step="0.25"
            value={playbackSpeed}
            onChange={(e) => useStore.getState().setPlaybackSpeed(parseFloat(e.target.value))}
          />
          <span style={{ fontSize: '11px', color: '#8080c0', minWidth: '40px' }}>
            {playbackSpeed}x
          </span>
        </div>
        <div className="control-row">
          <label>时间</label>
          <span style={{ fontSize: '11px', color: '#a0a0d0' }}>
            {timePosition.toFixed(2)}s / {maxDuration.toFixed(2)}s
          </span>
        </div>
        <div className="control-row">
          <input
            type="range"
            min="0"
            max={maxDuration}
            step="0.01"
            value={timePosition}
            onChange={(e) => setTimePosition(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        <div className="control-row">
          <label>性能</label>
          <span style={{ fontSize: '11px', color: '#8080c0' }}>
            {stats.fps} FPS
          </span>
        </div>
        <div className="control-row">
          <label>可见音符</label>
          <span style={{ fontSize: '11px', color: '#8080c0' }}>
            {stats.visibleNotes} / {stats.totalNotes}
          </span>
        </div>
        <div className="control-row">
          <label style={{ fontSize: '10px' }}>视锥体剔除</label>
          <input
            type="checkbox"
            checked={useFrustumCulling}
            onChange={() => useStore.getState().toggleFrustumCulling()}
          />
        </div>
        <div className="control-row">
          <label style={{ fontSize: '10px' }}>动态加载</label>
          <input
            type="checkbox"
            checked={dynamicLoading}
            onChange={() => useStore.getState().toggleDynamicLoading()}
          />
        </div>
        {loadingNotes && (
          <div style={{ fontSize: '10px', color: '#6366f1', marginTop: '4px' }}>
            加载中...
          </div>
        )}
      </div>

      <div className="track-legend">
        <div style={{ fontSize: '11px', color: '#8080c0', marginBottom: '4px' }}>
          图例
        </div>
        <div style={{ display: 'flex', gap: '12px', fontSize: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', background: '#ec4899' }}></div>
            <span>播放位置</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', background: 'rgba(34, 197, 94, 0.5)' }}></div>
            <span>标注区域</span>
          </div>
        </div>
      </div>

      {Object.entries(remoteCursors).map(([userId, cursor]) => {
        if (Date.now() - cursor.lastUpdate > 5000) return null
        const x = cursor.time * timeScale
        return (
          <div
            key={userId}
            className="cursor-indicator"
            style={{
              left: `${(x / 100) * 100}%`,
              top: '50%',
              transform: 'translateX(-50%)'
            }}
          >
            <div className="cursor-label">
              {cursor.username}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default ThreeJSVisualizer
