import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WellTrajectory, Point3D } from '../../../shared/types';
import { cubicBezier, hexToRgb } from '../../utils/geometry';
import { useStore } from '../../store/useStore';

interface WellTrajectory3DProps {
  trajectory: WellTrajectory;
  isSelected: boolean;
  showControlPoints?: boolean;
}

export function WellTrajectory3D({ 
  trajectory, 
  isSelected, 
  showControlPoints = true
}: WellTrajectory3DProps) {
  const tubeRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const indicatorRef = useRef<THREE.Mesh>(null);
  const setCurrentTrajectoryPoint = useStore((state) => state.setCurrentTrajectoryPoint);
  const showGeosteering = useStore((state) => state.showGeosteering);

  const { tubeGeometry, controlPoints, samplePoints } = useMemo(() => {
    const samplesPerSegment = 200;
    const curvePoints: THREE.Vector3[] = [];
    const samplePoints: Point3D[] = [];

    for (let segIdx = 0; segIdx < trajectory.segments.length; segIdx++) {
      const segment = trajectory.segments[segIdx];
      
      for (let i = 0; i <= samplesPerSegment; i++) {
        const t = i / samplesPerSegment;
        const point = cubicBezier(segment.p0, segment.p1, segment.p2, segment.p3, t);
        curvePoints.push(new THREE.Vector3(point.x, point.y, point.z));
        samplePoints.push(point);
      }
    }

    const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'catmullrom', 0.5);
    const tubeGeometry = new THREE.TubeGeometry(curve, curvePoints.length, 3, 12, false);

    const controlPoints: { position: THREE.Vector3; type: string; segmentIndex: number }[] = [];
    
    trajectory.segments.forEach((segment, segIdx) => {
      const pointTypes: ('p0' | 'p1' | 'p2' | 'p3')[] = ['p0', 'p1', 'p2', 'p3'];
      pointTypes.forEach((type) => {
        const point = segment[type];
        controlPoints.push({
          position: new THREE.Vector3(point.x, point.y, point.z),
          type,
          segmentIndex: segIdx
        });
      });
    });

    return { tubeGeometry, controlPoints, samplePoints };
  }, [trajectory]);

  const color = useMemo(() => {
    const rgb = hexToRgb(trajectory.color);
    return new THREE.Color(rgb.r, rgb.g, rgb.b);
  }, [trajectory.color]);

  useFrame((state) => {
    if (glowRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
      glowRef.current.scale.set(scale, scale, scale);
    }

    if (isSelected && showGeosteering && indicatorRef.current && samplePoints.length > 0) {
      const progress = (state.clock.elapsedTime * 0.1) % 1;
      const pointIndex = Math.floor(progress * (samplePoints.length - 1));
      const point = samplePoints[pointIndex];
      
      if (point) {
        indicatorRef.current.position.set(point.x, point.y, point.z);
        setCurrentTrajectoryPoint(point);
      }
    }
  });

  useEffect(() => {
    if (!isSelected || !showGeosteering) {
      setCurrentTrajectoryPoint(null);
    }
  }, [isSelected, showGeosteering, setCurrentTrajectoryPoint]);

  return (
    <group>
      <mesh ref={tubeRef} geometry={tubeGeometry}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isSelected ? 0.5 : 0.2}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>
      
      {isSelected && (
        <mesh ref={glowRef} geometry={tubeGeometry}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.3}
            side={THREE.BackSide}
          />
        </mesh>
      )}

      {isSelected && showGeosteering && (
        <mesh ref={indicatorRef}>
          <sphereGeometry args={[8, 16, 16]} />
          <meshBasicMaterial
            color="#00ff88"
            transparent
            opacity={0.8}
          />
        </mesh>
      )}

      {showControlPoints && isSelected && (
        <group>
          {controlPoints.map((cp, idx) => (
            <mesh
              key={`cp-${idx}`}
              position={cp.position}
            >
              <sphereGeometry args={[cp.type === 'p0' || cp.type === 'p3' ? 5 : 3, 16, 16]} />
              <meshStandardMaterial
                color={cp.type === 'p0' || cp.type === 'p3' ? '#ff6b35' : '#4ecdc4'}
                emissive={cp.type === 'p0' || cp.type === 'p3' ? '#ff6b35' : '#4ecdc4'}
                emissiveIntensity={0.5}
              />
            </mesh>
          ))}
          
          {trajectory.segments.map((segment, segIdx) => (
            <group key={`seg-lines-${segIdx}`}>
              <line>
                <bufferGeometry>
                  <bufferAttribute
                    attach="attributes-position"
                    count={4}
                    array={new Float32Array([
                      segment.p0.x, segment.p0.y, segment.p0.z,
                      segment.p1.x, segment.p1.y, segment.p1.z,
                      segment.p2.x, segment.p2.y, segment.p2.z,
                      segment.p3.x, segment.p3.y, segment.p3.z
                    ])}
                    itemSize={3}
                  />
                </bufferGeometry>
                <lineBasicMaterial color="#4ecdc4" transparent opacity={0.6} linewidth={1} />
              </line>
            </group>
          ))}
        </group>
      )}
    </group>
  );
}
