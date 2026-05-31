import { useRef, useCallback, useState, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cn } from '@/lib/utils';
import { useThreeScene } from '@/hooks/useThreeScene';
import { useBrushTool } from '@/hooks/useBrushTool';
import { useAnnotationStore } from '@/store/useAnnotationStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { usePointCloudStore } from '@/store/usePointCloudStore';
import { useCollaborationStore } from '@/store/useCollaborationStore';
import { pointCloudAPI } from '@/services/pointCloud';
import { collaborationAPI } from '@/services/collaboration';
import BrushPreview from './BrushPreview';
import LoadingOverlay from './LoadingOverlay';
import ControversialPointsOverlay from './ControversialPointsOverlay';
import QualityPanel from '../quality/QualityPanel';
import type { Point3D } from '@/types';
import { generateColorMap, getLabelColorArray } from '@/utils/colorMap';
import { parsePLY } from '@/utils/pointCloudUtils';

interface PointCloudViewerProps {
  pointCloudId: string;
  className?: string;
}

export default function PointCloudViewer({ pointCloudId, className }: PointCloudViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pointsObjectRef = useRef<THREE.Points | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [scene, setScene] = useState<THREE.Scene | null>(null);
  const [brushPos, setBrushPos] = useState<Point3D | null>(null);
  const [brushVisible, setBrushVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [currentLOD, setCurrentLOD] = useState(1);
  const [showQualityPanel, setShowQualityPanel] = useState(false);
  const [isAssessingQuality, setIsAssessingQuality] = useState(false);
  const [showControversialPoints, setShowControversialPoints] = useState(true);

  const { isBrushActive, currentLabelId, labels: labelDefs, setLabels } = useAnnotationStore();
  const { push, undo, redo } = useHistoryStore();
  const { setLoading, setLoadingProgress, setError } = usePointCloudStore();
  const { controversialPoints, qualityAssessments, setControversialPoints, setQualityAssessments } = useCollaborationStore();

  const positionsRef = useRef<Float32Array | null>(null);
  const colorsRef = useRef<Uint8Array | null>(null);
  const labelsRef = useRef<Uint32Array | null>(null);
  const colorMapRef = useRef<Map<number, [number, number, number]>>(new Map());

  useEffect(() => {
    colorMapRef.current = generateColorMap(labelDefs);
  }, [labelDefs]);

  useEffect(() => {
    const fetchLabels = async () => {
      try {
        const labelDefs = await pointCloudAPI.getLabelDefinitions();
        setLabels(labelDefs);
      } catch (e) {
        console.error('Failed to fetch label definitions:', e);
      }
    };
    fetchLabels();
  }, [setLabels]);

  const loadControversialPoints = useCallback(async () => {
    try {
      const result = await collaborationAPI.getControversialPoints(pointCloudId);
      setControversialPoints(result.controversialPoints || []);
    } catch (e) {
      console.error('Failed to load controversial points:', e);
    }
  }, [pointCloudId, setControversialPoints]);

  const loadQualityHistory = useCallback(async () => {
    try {
      const result = await collaborationAPI.getQualityHistory(pointCloudId);
      setQualityAssessments(result || []);
    } catch (e) {
      console.error('Failed to load quality history:', e);
    }
  }, [pointCloudId, setQualityAssessments]);

  const assessQuality = useCallback(async () => {
    setIsAssessingQuality(true);
    try {
      const result = await collaborationAPI.assessQuality(pointCloudId);
      await loadControversialPoints();
      await loadQualityHistory();
      
      if (result.needsReview) {
        setShowQualityPanel(true);
        setShowControversialPoints(true);
      }
    } catch (e) {
      console.error('Failed to assess quality:', e);
    } finally {
      setIsAssessingQuality(false);
    }
  }, [pointCloudId, loadControversialPoints, loadQualityHistory]);

  const jumpToControversialPoint = useCallback((pointIndex: number) => {
    if (!controlsRef.current || !positionsRef.current) return;
    
    const idx = pointIndex * 3;
    const x = positionsRef.current[idx];
    const y = positionsRef.current[idx + 1];
    const z = positionsRef.current[idx + 2];
    
    const target = new THREE.Vector3(x, y, z);
    controlsRef.current.target.copy(target);
    controlsRef.current.update();
  }, []);

  const updatePointColors = useCallback(() => {
    if (!pointsObjectRef.current || !labelsRef.current || colorMapRef.current.size === 0) return;

    const geometry = pointsObjectRef.current.geometry;
    const labelColors = getLabelColorArray(labelsRef.current, colorMapRef.current);
    
    if (colorsRef.current && colorsRef.current.length > 0) {
      const finalColors = new Float32Array(labelsRef.current.length * 3);
      for (let i = 0; i < labelsRef.current.length; i++) {
        const labelId = labelsRef.current[i];
        if (labelId === 0) {
          finalColors[i * 3] = colorsRef.current[i * 3] / 255;
          finalColors[i * 3 + 1] = colorsRef.current[i * 3 + 1] / 255;
          finalColors[i * 3 + 2] = colorsRef.current[i * 3 + 2] / 255;
        } else {
          finalColors[i * 3] = labelColors[i * 3];
          finalColors[i * 3 + 1] = colorsRef.current ? colorsRef.current[i * 3 + 1] / 255 : labelColors[i * 3 + 1];
          finalColors[i * 3 + 2] = labelColors[i * 3 + 2];
        }
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(finalColors, 3));
    } else {
      geometry.setAttribute('color', new THREE.BufferAttribute(labelColors, 3));
    }
    
    geometry.attributes.color.needsUpdate = true;
  }, []);

  const handleSceneReady = useCallback(
    (scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls) => {
      setScene(scene);
      controlsRef.current = controls;

      const loadPointCloud = async () => {
        setLoading(true);
        setLoadingProgress(0);
        setError(null);

        try {
          const lodData = await pointCloudAPI.getLODLevel(pointCloudId, currentLOD);
          setLoadingProgress(50);

          const positions = new Float32Array(lodData.points);
          const colors = lodData.colors ? new Uint8Array(lodData.colors) : null;
          const pointLabels = lodData.labels ? new Uint32Array(lodData.labels) : new Uint32Array(lodData.num_points);

          positionsRef.current = positions;
          colorsRef.current = colors;
          labelsRef.current = pointLabels;

          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

          const labelColorMap = generateColorMap(labelDefs);
          const labelColors = getLabelColorArray(pointLabels, labelColorMap);
          
          if (colors) {
            const finalColors = new Float32Array(pointLabels.length * 3);
            for (let i = 0; i < pointLabels.length; i++) {
              if (pointLabels[i] === 0) {
                finalColors[i * 3] = colors[i * 3] / 255;
                finalColors[i * 3 + 1] = colors[i * 3 + 1] / 255;
                finalColors[i * 3 + 2] = colors[i * 3 + 2] / 255;
              } else {
                finalColors[i * 3] = labelColors[i * 3];
                finalColors[i * 3 + 1] = labelColors[i * 3 + 1];
                finalColors[i * 3 + 2] = labelColors[i * 3 + 2];
              }
            }
            geometry.setAttribute('color', new THREE.BufferAttribute(finalColors, 3));
          } else {
            geometry.setAttribute('color', new THREE.BufferAttribute(labelColors, 3));
          }

          const material = new THREE.PointsMaterial({
            size: 0.08,
            vertexColors: true,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.9,
          });

          const points = new THREE.Points(geometry, material);
          scene.add(points);
          pointsObjectRef.current = points;

          const bbox = new THREE.Box3().setFromObject(points);
          const center = new THREE.Vector3();
          bbox.getCenter(center);
          const size = new THREE.Vector3();
          bbox.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);

          camera.position.set(center.x + maxDim, center.y + maxDim * 0.8, center.z + maxDim);
          controls.target.copy(center);
          controls.update();

          setLoadingProgress(100);
          setIsLoaded(true);
          
          loadControversialPoints();
          loadQualityHistory();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to load point cloud');
        } finally {
          setLoading(false);
        }
      };

      loadPointCloud();
    },
    [pointCloudId, currentLOD, setLoading, setLoadingProgress, setError, labelDefs, loadControversialPoints, loadQualityHistory]
  );

  const { sceneRef, cameraRef, raycasterRef, mouseRef } = useThreeScene({
    containerRef,
    onSceneReady: handleSceneReady,
    backgroundColor: 0x0f172a,
  });

  const handlePointsApplied = useCallback(
    async (indices: number[], labelId: number) => {
      if (!labelsRef.current) return;

      const oldLabels = indices.map(i => labelsRef.current![i]);

      indices.forEach(idx => {
        if (labelsRef.current) {
          labelsRef.current[idx] = labelId;
        }
      });

      updatePointColors();

      push({
        type: 'label',
        description: `标注 ${indices.length} 个点`,
        beforeState: {
          pointIndices: indices,
          labelIds: oldLabels,
        },
        afterState: {
          pointIndices: indices,
          labelIds: indices.map(() => labelId),
        },
      });

      try {
        await collaborationAPI.addLabels(pointCloudId, indices, labelId);
      } catch (e) {
        console.error('Failed to save labels:', e);
      }
    },
    [pointCloudId, push, updatePointColors]
  );

  const {
    startPainting,
    stopPainting,
    applyBrush,
    handleMouseMove,
    isPainting,
    brushPosition,
    brushPreviewVisible,
    selectedPointCount,
    enableBackFaceCulling,
    setEnableBackFaceCulling,
    setBrushShape,
    setBrushSize,
  } = useBrushTool({
    points: positionsRef.current,
    pointsObjectRef,
    raycasterRef,
    cameraRef,
    onPointsApplied: handlePointsApplied,
    enableBackFaceCulling: true,
  });

  useEffect(() => {
    const handleUndo = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const entry = undo();
        if (entry && labelsRef.current) {
          entry.beforeState.pointIndices.forEach((idx, i) => {
            if (labelsRef.current) {
              labelsRef.current[idx] = entry.beforeState.labelIds[i];
            }
          });
          updatePointColors();
        }
      }
    };

    const handleRedo = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        const entry = redo();
        if (entry && labelsRef.current) {
          entry.afterState.pointIndices.forEach((idx, i) => {
            if (labelsRef.current) {
              labelsRef.current[idx] = entry.afterState.labelIds[i];
            }
          });
          updatePointColors();
        }
      }
    };

    window.addEventListener('keydown', handleUndo);
    window.addEventListener('keydown', handleRedo);
    return () => {
      window.removeEventListener('keydown', handleUndo);
      window.removeEventListener('keydown', handleRedo);
    };
  }, [undo, redo, updatePointColors]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isBrushActive) return;
      if (e.button === 0) {
        startPainting();
      }
    },
    [isBrushActive, startPainting]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!isBrushActive) return;
      if (e.button === 0) {
        stopPainting();
        applyBrush(currentLabelId);
      }
    },
    [isBrushActive, stopPainting, applyBrush, currentLabelId]
  );

  const handleMouseMoveLocal = useCallback(
    (e: React.MouseEvent) => {
      handleMouseMove(e.nativeEvent);
      setBrushPos(brushPosition);
      setBrushVisible(brushPreviewVisible);
    },
    [handleMouseMove, brushPosition, brushPreviewVisible]
  );

  const latestQuality = qualityAssessments.length > 0 ? qualityAssessments[0] : null;

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full h-full bg-background-dark overflow-hidden',
        isBrushActive ? 'point-cloud-canvas brush-active' : 'point-cloud-canvas',
        className
      )}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMoveLocal}
      onMouseLeave={() => setBrushVisible(false)}
    >
      <LoadingOverlay />
      <BrushPreview scene={scene} visible={brushVisible} position={brushPos} />
      <ControversialPointsOverlay
        scene={scene}
        positions={positionsRef.current}
        controversialPoints={controversialPoints}
        visible={showControversialPoints && isLoaded}
      />

      {isPainting && selectedPointCount > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-surface border border-surface-border rounded-lg text-sm animate-fade-in">
          <span className="text-gray-300">已选择 </span>
          <span className="text-primary font-mono font-semibold">{selectedPointCount}</span>
          <span className="text-gray-300"> 个点</span>
        </div>
      )}

      {isBrushActive && (
        <div className="absolute top-4 right-4 bg-surface border border-surface-border rounded-lg p-3 min-w-[200px]">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            <span className="text-sm text-primary font-medium">画笔模式</span>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">背面剔除</span>
              <button
                onClick={() => setEnableBackFaceCulling(!enableBackFaceCulling)}
                className={`w-10 h-5 rounded-full transition-colors ${
                  enableBackFaceCulling ? 'bg-primary' : 'bg-surface-border'
                }`}
              >
                <div
                  className={`w-4 h-4 bg-white rounded-full transition-transform ${
                    enableBackFaceCulling ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">画笔形状</span>
              <select
                onChange={(e) => setBrushShape(e.target.value as 'sphere' | 'cube')}
                className="bg-surface-hover text-gray-200 text-xs rounded px-2 py-1 outline-none"
              >
                <option value="sphere">球形</option>
                <option value="cube">立方体</option>
              </select>
            </div>
            
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400">画笔大小</span>
                <span className="text-xs text-gray-300 font-mono">0.5</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="5"
                step="0.1"
                defaultValue="0.5"
                onChange={(e) => setBrushSize(parseFloat(e.target.value))}
                className="w-full h-2 bg-surface-dark rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {isLoaded && (
        <>
          <div className="absolute top-4 left-4 flex gap-2">
            <button
              onClick={assessQuality}
              disabled={isAssessingQuality}
              className="px-3 py-1.5 bg-primary hover:bg-primary/80 disabled:bg-primary/50 text-white text-xs rounded-md transition-colors flex items-center gap-2"
            >
              {isAssessingQuality ? (
                <>
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  评估中...
                </>
              ) : (
                '质量评估'
              )}
            </button>
            
            <button
              onClick={() => setShowQualityPanel(!showQualityPanel)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-2 ${
                showQualityPanel
                  ? 'bg-primary text-white'
                  : 'bg-surface hover:bg-surface-hover text-gray-300 border border-surface-border'
              }`}
            >
              {latestQuality && latestQuality.needsReview && (
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
              {showQualityPanel ? '隐藏面板' : '质量面板'}
            </button>

            <button
              onClick={() => setShowControversialPoints(!showControversialPoints)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-2 ${
                showControversialPoints
                  ? 'bg-purple-600 text-white'
                  : 'bg-surface hover:bg-surface-hover text-gray-300 border border-surface-border'
              }`}
            >
              <div className="w-2 h-2 bg-purple-500 rounded-full" />
              {showControversialPoints ? '隐藏争议点' : '显示争议点'}
            </button>
          </div>

          {showQualityPanel && (
            <div className="absolute top-14 left-4 w-80 z-50">
              <QualityPanel
                quality={latestQuality}
                controversialPoints={controversialPoints}
                onAssessQuality={assessQuality}
                onJumpToControversial={jumpToControversialPoint}
                isLoading={isAssessingQuality}
              />
            </div>
          )}

          {latestQuality && latestQuality.needsReview && !showQualityPanel && (
            <div className="absolute top-14 left-4 px-3 py-2 bg-red-500/20 border border-red-500/30 rounded-md">
              <div className="flex items-center gap-2 text-red-400 text-xs">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span>标注一致性较低，点击查看详细报告</span>
              </div>
            </div>
          )}

          <div className="absolute bottom-4 right-4 px-3 py-1.5 bg-surface/80 border border-surface-border rounded-md text-xs text-gray-400 flex items-center gap-2">
            <span>LOD:</span>
            <select
              value={currentLOD}
              onChange={(e) => setCurrentLOD(Number(e.target.value))}
              className="bg-transparent text-gray-200 outline-none cursor-pointer"
            >
              <option value={0}>0 - 最高</option>
              <option value={1}>1 - 高</option>
              <option value={2}>2 - 中</option>
              <option value={3}>3 - 低</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}
