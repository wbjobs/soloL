import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PotreeMetadata, PotreeOctreeNode } from '../../../shared/types';
import { potreeAPI } from '../../utils/api';

interface OctreeNodeData {
  id: string;
  node: PotreeOctreeNode;
  loaded: boolean;
  visible: boolean;
  points?: THREE.Points;
  pointCount: number;
  screenSize: number;
}

interface PotreePointCloudProps {
  gridId: string;
  pointSize?: number;
  maxVisiblePoints?: number;
  lodThreshold?: number;
  showBoundingBox?: boolean;
}

export function PotreePointCloud({
  gridId,
  pointSize = 3,
  maxVisiblePoints = 200000,
  lodThreshold = 50,
  showBoundingBox = false
}: PotreePointCloudProps) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  
  const [metadata, setMetadata] = useState<PotreeMetadata | null>(null);
  const [nodeDataMap, setNodeDataMap] = useState<Map<string, OctreeNodeData>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [, setTotalPoints] = useState(0);
  
  useEffect(() => {
    const loadMetadata = async () => {
      setIsLoading(true);
      try {
        const meta = await potreeAPI.getMetadata(gridId);
        setMetadata(meta);
        
        if (meta && meta.hierarchy && meta.hierarchy.root) {
          const rootData: OctreeNodeData = {
            id: 'r',
            node: meta.hierarchy.root,
            loaded: false,
            visible: false,
            pointCount: meta.hierarchy.root.pointCount,
            screenSize: 0
          };
          
          setNodeDataMap(new Map([['r', rootData]]));
        }
      } catch (error) {
        console.error('Failed to load Potree metadata:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadMetadata();
  }, [gridId]);
  
  const calculateScreenSize = useCallback((node: PotreeOctreeNode) => {
    if (!metadata) return 0;
    
    const bbox = node.boundingBox;
    const center = new THREE.Vector3(bbox.center.x, bbox.center.y, bbox.center.z);
    const distance = camera.position.distanceTo(center);
    
    const boxSize = Math.max(
      bbox.max.x - bbox.min.x,
      bbox.max.y - bbox.min.y,
      bbox.max.z - bbox.min.z
    );
    
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const screenHeight = 2 * distance * Math.tan(fov / 2);
    
    return (boxSize / screenHeight) * window.innerHeight;
  }, [camera, metadata]);
  
  const loadNodeData = useCallback(async (nodeId: string) => {
    const nodeData = nodeDataMap.get(nodeId);
    if (!nodeData || nodeData.loaded) return;
    
    try {
      const buffer = await potreeAPI.getNodeData(gridId, nodeId);
      
      const pointCount = buffer.byteLength / 20;
      const positions = new Float32Array(pointCount * 3);
      const colors = new Float32Array(pointCount * 3);
      
      const dataView = new DataView(buffer);
      
      for (let i = 0; i < pointCount; i++) {
        const offset = i * 20;
        
        positions[i * 3] = dataView.getFloat32(offset, true);
        positions[i * 3 + 1] = dataView.getFloat32(offset + 4, true);
        positions[i * 3 + 2] = dataView.getFloat32(offset + 8, true);
        
        colors[i * 3] = dataView.getUint8(offset + 12) / 255;
        colors[i * 3 + 1] = dataView.getUint8(offset + 13) / 255;
        colors[i * 3 + 2] = dataView.getUint8(offset + 14) / 255;
      }
      
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      
      const material = new THREE.PointsMaterial({
        size: pointSize,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        sizeAttenuation: true
      });
      
      const points = new THREE.Points(geometry, material);
      
      setNodeDataMap(prev => {
        const newMap = new Map(prev);
        newMap.set(nodeId, {
          ...nodeData,
          loaded: true,
          points
        });
        return newMap;
      });
      
    } catch (error) {
      console.error(`Failed to load node ${nodeId}:`, error);
    }
  }, [gridId, nodeDataMap, pointSize]);
  
  const updateVisibleNodes = useCallback(() => {
    if (!metadata) return;
    
    const visibleNodes: string[] = [];
    let visiblePointCount = 0;
    
    const traverse = (nodeId: string) => {
      const nodeData = nodeDataMap.get(nodeId);
      if (!nodeData) return;
      
      const screenSize = calculateScreenSize(nodeData.node);
      nodeData.screenSize = screenSize;
      
      if (screenSize < lodThreshold / 2) {
        if (visiblePointCount < maxVisiblePoints) {
          visibleNodes.push(nodeId);
          visiblePointCount += nodeData.pointCount;
          
          if (!nodeData.loaded) {
            loadNodeData(nodeId);
          }
        }
        return;
      }
      
      if (nodeData.node.hasChildren && nodeData.node.children.length > 0) {
        for (const childId of nodeData.node.children) {
          if (visiblePointCount < maxVisiblePoints) {
            traverse(childId);
          }
        }
      } else {
        if (visiblePointCount < maxVisiblePoints) {
          visibleNodes.push(nodeId);
          visiblePointCount += nodeData.pointCount;
          
          if (!nodeData.loaded) {
            loadNodeData(nodeId);
          }
        }
      }
    };
    
    traverse('r');
    
    setNodeDataMap(prev => {
      const newMap = new Map(prev);
      newMap.forEach((data, id) => {
        data.visible = visibleNodes.includes(id);
      });
      return newMap;
    });
    
    setTotalPoints(visiblePointCount);
    
  }, [metadata, nodeDataMap, calculateScreenSize, loadNodeData, lodThreshold, maxVisiblePoints]);
  
  useFrame(() => {
    if (metadata && !isLoading) {
      updateVisibleNodes();
    }
  });
  
  const visiblePointClouds = useMemo(() => {
    const clouds: { id: string; points: THREE.Points }[] = [];
    
    nodeDataMap.forEach((data, id) => {
      if (data.visible && data.loaded && data.points) {
        clouds.push({ id, points: data.points });
      }
    });
    
    return clouds;
  }, [nodeDataMap]);
  
  if (isLoading) {
    return (
      <group ref={groupRef}>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[10, 10, 10]} />
          <meshBasicMaterial color="#444" wireframe />
        </mesh>
      </group>
    );
  }
  
  return (
    <group ref={groupRef}>
      {visiblePointClouds.map(({ id, points }) => (
        <primitive key={id} object={points} />
      ))}
      
      {showBoundingBox && (
        <group>
          {Array.from(nodeDataMap.entries()).filter(([, data]) => data.visible).map(([id, data]) => {
            const bbox = data.node.boundingBox;
            const size = {
              x: bbox.max.x - bbox.min.x,
              y: bbox.max.y - bbox.min.y,
              z: bbox.max.z - bbox.min.z
            };
            
            return (
              <mesh
                key={`bbox-${id}`}
                position={[bbox.center.x, bbox.center.y, bbox.center.z]}
              >
                <boxGeometry args={[size.x, size.y, size.z]} />
                <meshBasicMaterial color="#00ff00" wireframe transparent opacity={0.3} />
              </mesh>
            );
          })}
        </group>
      )}
      
      <sprite position={[
        metadata?.boundingBox.center.x || 0,
        metadata?.boundingBox.center.y || 0,
        (metadata?.boundingBox.max.z || 0) + 50
      ]}>
        <spriteMaterial color="#00ffff" opacity={0.8} />
      </sprite>
    </group>
  );
}
