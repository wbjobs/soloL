import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BlendShapes } from '../types';

interface AvatarViewerProps {
  modelUrl?: string;
  blendShapes?: BlendShapes;
  className?: string;
}

const AVATAR_MODELS = [
  {
    id: 'default',
    name: '默认头像',
    url: 'https://threejs.org/examples/models/gltf/LeePerrySmith/LeePerrySmith.glb',
    thumbnail: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop'
  },
  {
    id: 'robot',
    name: '机器人',
    url: 'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
    thumbnail: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=200&h=200&fit=crop'
  },
  {
    id: 'female',
    name: '女性头像',
    url: 'https://threejs.org/examples/models/gltf/Female02/Female02.glb',
    thumbnail: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop'
  }
];

export function AvatarViewer({ modelUrl, blendShapes = {}, className = '' }: AvatarViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationFrameRef = useRef<number>(0);
  const morphTargetMeshesRef = useRef<THREE.Mesh[]>([]);

  const loadModel = useCallback((url: string) => {
    if (!sceneRef.current) return;

    if (modelRef.current) {
      sceneRef.current.remove(modelRef.current);
      modelRef.current = null;
      morphTargetMeshesRef.current = [];
    }

    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(1);
        model.position.set(0, 0, 0);

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        model.position.y = 0;

        const meshes: THREE.Mesh[] = [];
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            meshes.push(child);
            if (child.morphTargetInfluences) {
              console.log('Morph targets available:', child.morphTargetDictionary);
            }
          }
        });

        morphTargetMeshesRef.current = meshes;
        modelRef.current = model;
        sceneRef.current.add(model);

        if (gltf.animations && gltf.animations.length > 0) {
          mixerRef.current = new THREE.AnimationMixer(model);
          const action = mixerRef.current.clipAction(gltf.animations[0]);
          action.play();
        }
      },
      undefined,
      (error) => {
        console.error('Error loading model:', error);
        createFallbackModel();
      }
    );
  }, []);

  const createFallbackModel = useCallback(() => {
    if (!sceneRef.current) return;

    const group = new THREE.Group();

    const headGeometry = new THREE.SphereGeometry(1, 64, 64);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xfdbcb4,
      metalness: 0.1,
      roughness: 0.8
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 0.5;
    group.add(head);

    const eyeGeometry = new THREE.SphereGeometry(0.15, 32, 32);
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const pupilGeometry = new THREE.SphereGeometry(0.08, 32, 32);
    const pupilMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });

    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(-0.35, 0.6, 0.85);
    group.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    rightEye.position.set(0.35, 0.6, 0.85);
    group.add(rightEye);

    const leftPupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
    leftPupil.position.set(-0.35, 0.6, 0.95);
    group.add(leftPupil);

    const rightPupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
    rightPupil.position.set(0.35, 0.6, 0.95);
    group.add(rightPupil);

    const mouthGeometry = new THREE.TorusGeometry(0.2, 0.03, 16, 32, Math.PI);
    const mouthMaterial = new THREE.MeshStandardMaterial({ color: 0xd4726a });
    const mouth = new THREE.Mesh(mouthGeometry, mouthMaterial);
    mouth.position.set(0, 0.1, 0.85);
    mouth.rotation.x = Math.PI;
    group.add(mouth);

    modelRef.current = group;
    sceneRef.current.add(group);
  }, []);

  const updateBlendShapes = useCallback((shapes: BlendShapes) => {
    morphTargetMeshesRef.current.forEach((mesh) => {
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;

      Object.entries(shapes).forEach(([name, value]) => {
        const index = mesh.morphTargetDictionary[name];
        if (index !== undefined) {
          mesh.morphTargetInfluences[index] = value;
        }
      });
    });

    if (modelRef.current) {
      const head = modelRef.current.children[0];
      if (head) {
        head.rotation.y = (shapes['headYaw'] || 0) * 0.5;
        head.rotation.x = (shapes['headPitch'] || 0) * 0.3;
      }
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 1, 4);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const rimLight = new THREE.DirectionalLight(0x6366f1, 0.3);
    rimLight.position.set(-5, 3, -5);
    scene.add(rimLight);

    createFallbackModel();

    const clock = new THREE.Clock();
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      const delta = clock.getDelta();
      if (mixerRef.current) {
        mixerRef.current.update(delta);
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameRef.current);
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, [createFallbackModel]);

  useEffect(() => {
    if (modelUrl) {
      loadModel(modelUrl);
    }
  }, [modelUrl, loadModel]);

  useEffect(() => {
    updateBlendShapes(blendShapes);
  }, [blendShapes, updateBlendShapes]);

  return (
    <div ref={containerRef} className={`avatar-canvas ${className}`} />
  );
}

export { AVATAR_MODELS };
