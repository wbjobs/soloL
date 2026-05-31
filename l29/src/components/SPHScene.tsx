import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { SPHEngine, ForceFeedbackResult } from '@/engine/SPHEngine';
import { ObstacleManager, ObstacleData, createDefaultObstacleData, ObstacleType } from '@/engine/ObstacleManager';
import { SPHParams } from '@/types/sph';

interface SPHSceneProps {
  params: SPHParams;
  isRunning: boolean;
  onPerformanceUpdate: (fps: number, frameTime: number, computeTime: number) => void;
  resetTrigger: number;
  selectedObstacleType: ObstacleType | null;
  onObstacleCreated?: (obstacle: ObstacleData) => void;
  onObstacleSelected?: (obstacleId: string | null) => void;
  selectedObstacleId: string | null;
  onDeleteObstacle?: (obstacleId: string) => void;
}

export default function SPHScene({
  params,
  isRunning,
  onPerformanceUpdate,
  resetTrigger,
  selectedObstacleType,
  onObstacleCreated,
  onObstacleSelected,
  selectedObstacleId,
  onDeleteObstacle,
}: SPHSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const boundaryRef = useRef<THREE.LineSegments | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const groundPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  
  const physicsWorldRef = useRef<RAPIER.World | null>(null);
  const obstacleManagerRef = useRef<ObstacleManager | null>(null);
  const engineRef = useRef<SPHEngine | null>(null);
  const instancedMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const animationIdRef = useRef<number>(0);
  const selectionHighlightRef = useRef<THREE.Mesh | null>(null);
  
  const lastTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const fpsTimeRef = useRef<number>(0);
  const accumulatorRef = useRef<number>(0);
  const physicsAccumulatorRef = useRef<number>(0);
  
  const [webgpuSupported, setWebgpuSupported] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [particleCount, setParticleCount] = useState(params.particleCount);
  const [rapierLoaded, setRapierLoaded] = useState(false);

  const updateObstacleHighlight = useCallback(() => {
    if (!selectionHighlightRef.current || !obstacleManagerRef.current) return;
    
    if (selectedObstacleId) {
      const mesh = obstacleManagerRef.current.getObstacleMesh(selectedObstacleId);
      if (mesh) {
        selectionHighlightRef.current.visible = true;
        selectionHighlightRef.current.position.copy(mesh.position);
        selectionHighlightRef.current.quaternion.copy(mesh.quaternion);
        selectionHighlightRef.current.scale.copy(mesh.scale).multiplyScalar(1.05);
        (selectionHighlightRef.current.material as THREE.MeshBasicMaterial).opacity = 
          0.3 + 0.2 * Math.sin(performance.now() * 0.005);
      }
    } else {
      selectionHighlightRef.current.visible = false;
    }
  }, [selectedObstacleId]);

  const handleClick = useCallback((event: MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !sceneRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    
    if (event.shiftKey && selectedObstacleType) {
      const targetPoint = new THREE.Vector3();
      raycasterRef.current.ray.intersectPlane(groundPlaneRef.current, targetPoint);
      
      targetPoint.y = Math.max(targetPoint.y, -params.boundarySize * 0.3);
      targetPoint.x = THREE.MathUtils.clamp(targetPoint.x, -params.boundarySize * 0.4, params.boundarySize * 0.4);
      targetPoint.z = THREE.MathUtils.clamp(targetPoint.z, -params.boundarySize * 0.4, params.boundarySize * 0.4);
      
      const obstacleData = createDefaultObstacleData(selectedObstacleType, targetPoint);
      const id = obstacleManagerRef.current?.addObstacle(obstacleData);
      
      if (id && onObstacleCreated) {
        const created = obstacleManagerRef.current?.getObstacle(id);
        if (created) {
          onObstacleCreated(created);
        }
      }
      return;
    }
    
    if (obstacleManagerRef.current) {
      const obstacleMeshes: THREE.Mesh[] = [];
      for (const obs of obstacleManagerRef.current.getAllObstacles()) {
        const mesh = obstacleManagerRef.current.getObstacleMesh(obs.id);
        if (mesh) obstacleMeshes.push(mesh);
      }
      
      const intersects = raycasterRef.current.intersectObjects(obstacleMeshes);
      
      if (intersects.length > 0) {
        const mesh = intersects[0].object as THREE.Mesh;
        const obstacleId = mesh.userData.obstacleId as string;
        if (onObstacleSelected) {
          onObstacleSelected(obstacleId === selectedObstacleId ? null : obstacleId);
        }
      } else if (!event.shiftKey) {
        if (onObstacleSelected) {
          onObstacleSelected(null);
        }
      }
    }
  }, [selectedObstacleType, onObstacleCreated, onObstacleSelected, selectedObstacleId, params.boundarySize]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selectedObstacleId && onDeleteObstacle) {
        obstacleManagerRef.current?.removeObstacle(selectedObstacleId);
        onDeleteObstacle(selectedObstacleId);
        if (onObstacleSelected) {
          onObstacleSelected(null);
        }
      }
    }
  }, [selectedObstacleId, onDeleteObstacle, onObstacleSelected]);

  useEffect(() => {
    let mounted = true;

    const initRapier = async () => {
      await RAPIER.init();
      if (mounted) {
        setRapierLoaded(true);
      }
    };
    initRapier();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || !rapierLoaded) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e1a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      100
    );
    camera.position.set(3.5, 3, 3.5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0x404050, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(5, 10, 5);
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0x00ccff, 0.8, 15);
    pointLight.position.set(0, 3, 0);
    scene.add(pointLight);

    const boundaryGeometry = new THREE.BoxGeometry(params.boundarySize, params.boundarySize, params.boundarySize);
    const boundaryEdges = new THREE.EdgesGeometry(boundaryGeometry);
    const boundaryLine = new THREE.LineSegments(
      boundaryEdges,
      new THREE.LineBasicMaterial({ color: 0x223344, transparent: true, opacity: 0.4 })
    );
    scene.add(boundaryLine);
    boundaryRef.current = boundaryLine;

    const highlightGeo = new THREE.BoxGeometry(1, 1, 1);
    const highlightMat = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.3,
      wireframe: true,
    });
    const highlight = new THREE.Mesh(highlightGeo, highlightMat);
    highlight.visible = false;
    scene.add(highlight);
    selectionHighlightRef.current = highlight;

    const physicsWorld = new RAPIER.World(new RAPIER.Vector3(0.0, -9.81, 0.0));
    physicsWorldRef.current = physicsWorld;

    const obstacleManager = new ObstacleManager(scene, physicsWorld, 32);
    obstacleManagerRef.current = obstacleManager;

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(containerRef.current.clientWidth, containerRef.current.clientHeight),
      0.6,
      0.4,
      0.85
    );
    composer.addPass(bloomPass);
    composerRef.current = composer;

    renderer.domElement.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);

    const handleResize = () => {
      if (!containerRef.current || !camera || !renderer || !composer) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(animationIdRef.current);
      obstacleManager.dispose();
      renderer.dispose();
      engineRef.current?.destroy();
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [rapierLoaded, handleClick, handleKeyDown]);

  useEffect(() => {
    if (!sceneRef.current || !rapierLoaded) return;
    
    if (instancedMeshRef.current) {
      sceneRef.current.remove(instancedMeshRef.current);
      instancedMeshRef.current.geometry.dispose();
      (instancedMeshRef.current.material as THREE.Material).dispose();
    }

    const particleGeometry = new THREE.SphereGeometry(params.particleRadius, 8, 6);
    const particleMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ccff,
      metalness: 0.3,
      roughness: 0.4,
      emissive: 0x002233,
      emissiveIntensity: 0.3,
      vertexColors: true,
    });

    const instancedMesh = new THREE.InstancedMesh(
      particleGeometry,
      particleMaterial,
      params.particleCount
    );
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(params.particleCount * 3),
      3
    );
    instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    sceneRef.current.add(instancedMesh);
    instancedMeshRef.current = instancedMesh;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < params.particleCount; i++) {
      dummy.position.set(
        (Math.random() - 0.5) * 1.5,
        Math.random() * 1.5,
        (Math.random() - 0.5) * 1.5
      );
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.55, 0.8, 0.5);
      instancedMesh.setColorAt(i, color);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    instancedMesh.instanceColor.needsUpdate = true;

    setIsLoading(true);
    engineRef.current?.destroy();
    
    const engine = new SPHEngine(params.particleCount);
    engine.init().then((success) => {
      setWebgpuSupported(success);
      setIsLoading(false);
      if (success) {
        engineRef.current = engine;
        setParticleCount(params.particleCount);
      }
    });
  }, [params.particleCount, params.particleRadius, rapierLoaded]);

  useEffect(() => {
    if (boundaryRef.current) {
      boundaryRef.current.geometry.dispose();
      const boundaryGeometry = new THREE.BoxGeometry(params.boundarySize, params.boundarySize, params.boundarySize);
      boundaryRef.current.geometry = new THREE.EdgesGeometry(boundaryGeometry);
    }
  }, [params.boundarySize]);

  useEffect(() => {
    if (!engineRef.current || !sceneRef.current || !physicsWorldRef.current || !obstacleManagerRef.current) return;

    let frameIndex = 0;

    const animate = async (time: number) => {
      animationIdRef.current = requestAnimationFrame(animate);
      
      controlsRef.current?.update();
      updateObstacleHighlight();

      const deltaTime = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;

      frameCountRef.current++;
      if (time - fpsTimeRef.current >= 1000) {
        const fps = frameCountRef.current;
        const frameTime = 1000 / fps;
        onPerformanceUpdate(fps, frameTime, frameTime * 0.6);
        frameCountRef.current = 0;
        fpsTimeRef.current = time;
      }

      if (isRunning) {
        physicsAccumulatorRef.current += deltaTime;
        while (physicsAccumulatorRef.current >= 1 / 60) {
          physicsWorldRef.current.timestep = 1 / 60;
          physicsWorldRef.current.step();
          obstacleManagerRef.current.updateFromPhysics();
          physicsAccumulatorRef.current -= 1 / 60;
        }

        if (engineRef.current?.isInitialized()) {
          const obstacleGPUData = obstacleManagerRef.current.getGPUData();
          const obstacleCount = obstacleManagerRef.current.getObstacleCount();
          engineRef.current.updateObstacles(obstacleGPUData, obstacleCount);

          accumulatorRef.current += deltaTime;
          while (accumulatorRef.current >= params.timeStep) {
            engineRef.current.step(params);
            accumulatorRef.current -= params.timeStep;
          }

          if (obstacleCount > 0) {
            const forceFeedback = await engineRef.current.getForceFeedback();
            if (forceFeedback) {
              forceFeedback.forEach((fb: ForceFeedbackResult, index) => {
                const obstacleId = obstacleManagerRef.current!.getObstacleIdByIndex(index);
                if (obstacleId) {
                  obstacleManagerRef.current!.applyForceToObstacle(
                    obstacleId,
                    new THREE.Vector3(fb.forceX, fb.forceY, fb.forceZ),
                    new THREE.Vector3(fb.torqueX, fb.torqueY, fb.torqueZ)
                  );
                }
              });
            }
          }

          if (frameIndex % 2 === 0) {
            const particleData = await engineRef.current.getParticleData();

            if (particleData && instancedMeshRef.current) {
              const { positions, velocities } = particleData;
              const dummy = new THREE.Object3D();
              const color = new THREE.Color();
              const count = Math.min(params.particleCount, positions.length / 4);

              for (let i = 0; i < count; i++) {
                const px = positions[i * 4];
                const py = positions[i * 4 + 1];
                const pz = positions[i * 4 + 2];
                const density = positions[i * 4 + 3];

                const vx = velocities[i * 4];
                const vy = velocities[i * 4 + 1];
                const vz = velocities[i * 4 + 2];
                const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

                dummy.position.set(px, py, pz);
                dummy.updateMatrix();
                instancedMeshRef.current.setMatrixAt(i, dummy.matrix);

                let t: number;
                if (params.colorMode === 'velocity') {
                  t = Math.min(speed * 3, 1);
                } else if (params.colorMode === 'density') {
                  t = Math.min(Math.max((density - params.restDensity * 0.3) / params.restDensity, 0), 1);
                } else {
                  const pressure = params.stiffness * (density - params.restDensity);
                  t = Math.min(Math.max(pressure / 2000, 0), 1);
                }

                color.setHSL(0.55 - t * 0.5, 0.8, 0.45 + t * 0.15);
                instancedMeshRef.current.setColorAt(i, color);
              }

              instancedMeshRef.current.instanceMatrix.needsUpdate = true;
              instancedMeshRef.current.instanceColor!.needsUpdate = true;
            }
          }
          frameIndex++;
        }
      }

      if (composerRef.current && params.bloomEnabled) {
        composerRef.current.render();
      } else if (rendererRef.current && cameraRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    animationIdRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationIdRef.current);
    };
  }, [params, isRunning, onPerformanceUpdate, particleCount, rapierLoaded, updateObstacleHighlight]);

  useEffect(() => {
    if (resetTrigger > 0) {
      engineRef.current?.reset();
      accumulatorRef.current = 0;
      physicsAccumulatorRef.current = 0;
    }
  }, [resetTrigger]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {!rapierLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0e1a] bg-opacity-90 z-10">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-cyan-400 text-lg">加载物理引擎...</p>
          </div>
        </div>
      )}
      
      {isLoading && rapierLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0e1a] bg-opacity-90 z-10">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-cyan-400 text-lg">初始化 WebGPU SPH 引擎...</p>
            <p className="text-gray-500 text-sm mt-2">正在编译 Compute Shaders ({params.particleCount.toLocaleString()} 粒子)</p>
          </div>
        </div>
      )}
      
      {webgpuSupported === false && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0e1a] z-10">
          <div className="text-center max-w-md p-8">
            <div className="text-6xl mb-4">⚠️</div>
            <h2 className="text-red-400 text-2xl font-bold mb-4">WebGPU 不受支持</h2>
            <p className="text-gray-400 mb-4">
              您的浏览器不支持 WebGPU。请使用支持 WebGPU 的浏览器（如 Chrome 113+、Edge 113+）访问此页面。
            </p>
            <p className="text-gray-500 text-sm">
              在 Chrome 中，您可能需要在 chrome://flags 中启用 "WebGPU" 标志
            </p>
          </div>
        </div>
      )}

      {selectedObstacleType && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20">
          <div className="bg-black/70 backdrop-blur-md rounded-lg px-4 py-2 border border-amber-500/50 text-amber-400 text-sm">
            按住 Shift + 点击放置{selectedObstacleType === 'box' ? '立方体' : '球体'}
          </div>
        </div>
      )}
      
      {selectedObstacleId && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20">
          <div className="bg-black/70 backdrop-blur-md rounded-lg px-4 py-2 border border-yellow-500/50 text-yellow-400 text-sm">
            按 Delete 键删除选中物体
          </div>
        </div>
      )}
    </div>
  );
}
