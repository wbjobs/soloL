import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface UseThreeSceneOptions {
  containerRef: React.RefObject<HTMLDivElement>;
  onSceneReady?: (scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls) => void;
  onAnimationFrame?: (delta: number) => void;
  backgroundColor?: number;
  cameraPosition?: [number, number, number];
  fov?: number;
  near?: number;
  far?: number;
}

interface UseThreeSceneReturn {
  sceneRef: React.RefObject<THREE.Scene | null>;
  cameraRef: React.RefObject<THREE.PerspectiveCamera | null>;
  rendererRef: React.RefObject<THREE.WebGLRenderer | null>;
  controlsRef: React.RefObject<OrbitControls | null>;
  raycasterRef: React.RefObject<THREE.Raycaster | null>;
  mouseRef: React.RefObject<THREE.Vector2 | null>;
  resize: () => void;
  render: () => void;
}

export const useThreeScene = (
  options: UseThreeSceneOptions
): UseThreeSceneReturn => {
  const {
    containerRef,
    onSceneReady,
    onAnimationFrame,
    backgroundColor = 0x1a1a2e,
    cameraPosition = [10, 10, 10],
    fov = 60,
    near = 0.1,
    far = 10000,
  } = options;

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const mouseRef = useRef<THREE.Vector2 | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const clockRef = useRef<THREE.Clock | null>(null);

  const resize = useCallback(() => {
    if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;

    const { clientWidth, clientHeight } = containerRef.current;
    cameraRef.current.aspect = clientWidth / clientHeight;
    cameraRef.current.updateProjectionMatrix();
    rendererRef.current.setSize(clientWidth, clientHeight);
  }, [containerRef]);

  const render = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    rendererRef.current.render(sceneRef.current, cameraRef.current);
  }, []);

  const animate = useCallback(() => {
    if (!clockRef.current || !controlsRef.current) return;

    const delta = clockRef.current.getDelta();
    controlsRef.current.update();

    if (onAnimationFrame) {
      onAnimationFrame(delta);
    }

    render();
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [onAnimationFrame, render]);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor);
    sceneRef.current = scene;

    const { clientWidth, clientHeight } = containerRef.current;
    const camera = new THREE.PerspectiveCamera(fov, clientWidth / clientHeight, near, far);
    camera.position.set(...cameraPosition);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(clientWidth, clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 1000;
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0xffffff, 0.4);
    pointLight.position.set(-10, 10, -10);
    scene.add(pointLight);

    const gridHelper = new THREE.GridHelper(100, 100, 0x444444, 0x333333);
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    raycasterRef.current = new THREE.Raycaster();
    mouseRef.current = new THREE.Vector2();
    clockRef.current = new THREE.Clock();

    window.addEventListener('resize', resize);

    if (onSceneReady) {
      onSceneReady(scene, camera, controls);
    }

    animate();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      controls.dispose();
      renderer.dispose();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [containerRef, backgroundColor, cameraPosition, fov, near, far, onSceneReady, animate, resize]);

  return {
    sceneRef,
    cameraRef,
    rendererRef,
    controlsRef,
    raycasterRef,
    mouseRef,
    resize,
    render,
  };
};

export default useThreeScene;
