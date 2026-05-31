import { useState, useCallback, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';

const ARRIVAL_THRESHOLD = 1.5;

export function useNavigation({ path, userPositionRef, autoAdvance = true } = {}) {
  const [waypointIndex, setWaypointIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const prevIndexRef = useRef(0);

  const currentPath = path || [];

  useFrame(() => {
    if (!currentPath.length || isComplete || !userPositionRef?.current || !autoAdvance) return;

    const wp = currentPath[waypointIndex];
    if (!wp) return;

    const pos = userPositionRef.current;
    const wpPos = wp.position;
    const dx = wpPos.x - pos.x;
    const dz = wpPos.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < ARRIVAL_THRESHOLD && waypointIndex < currentPath.length - 1) {
      if (prevIndexRef.current !== waypointIndex + 1) {
        prevIndexRef.current = waypointIndex + 1;
        setWaypointIndex(waypointIndex + 1);
      }
    } else if (dist < ARRIVAL_THRESHOLD && waypointIndex === currentPath.length - 1) {
      setIsComplete(true);
    }
  });

  const currentWaypoint = currentPath[waypointIndex] || null;
  const nextWaypoint = currentPath[waypointIndex + 1] || null;

  const computed = useMemo(() => {
    if (!currentWaypoint || !userPositionRef?.current) {
      return { bearing: 0, distance: 0 };
    }
    const pos = userPositionRef.current;
    const dx = currentWaypoint.position.x - pos.x;
    const dz = currentWaypoint.position.z - pos.z;
    return {
      bearing: Math.atan2(dx, dz) * (180 / Math.PI),
      distance: Math.sqrt(dx * dx + dz * dz),
    };
  }, [currentWaypoint, userPositionRef]);

  const advanceWaypoint = useCallback(() => {
    if (waypointIndex < currentPath.length - 1) {
      prevIndexRef.current = waypointIndex + 1;
      setWaypointIndex(waypointIndex + 1);
    } else {
      setIsComplete(true);
    }
  }, [waypointIndex, currentPath.length]);

  const skipWaypoint = useCallback(() => {
    advanceWaypoint();
  }, [advanceWaypoint]);

  const reset = useCallback(() => {
    prevIndexRef.current = 0;
    setWaypointIndex(0);
    setIsComplete(false);
  }, []);

  return {
    currentWaypoint,
    nextWaypoint,
    bearing: computed.bearing,
    distance: computed.distance,
    waypointIndex,
    totalWaypoints: currentPath.length,
    advanceWaypoint,
    skipWaypoint,
    isComplete,
    reset,
  };
}

export default useNavigation;
