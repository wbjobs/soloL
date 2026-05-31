import { useCallback, useRef } from 'react';
import { BackgroundConfig, GestureType } from '../types';

export function useStatistics(userId: string) {
  const currentBackgroundStartRef = useRef<number>(Date.now());
  const currentBackgroundRef = useRef<BackgroundConfig>({ type: 'none' });

  const reportBackgroundStart = useCallback((config: BackgroundConfig) => {
    const now = Date.now();
    const durationMs = now - currentBackgroundStartRef.current;

    if (currentBackgroundRef.current.type !== 'none' && durationMs > 1000) {
      fetch(`/api/stats/${userId}/background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backgroundType: currentBackgroundRef.current.type,
          backgroundUrl: currentBackgroundRef.current.url,
          durationMs
        })
      }).catch(() => {});
    }

    currentBackgroundStartRef.current = now;
    currentBackgroundRef.current = config;
  }, [userId]);

  const reportGesture = useCallback((gesture: GestureType, backgroundTriggered: string) => {
    fetch(`/api/stats/${userId}/gesture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gesture, backgroundTriggered })
    }).catch(() => {});
  }, [userId]);

  const getSummary = useCallback(async (days: number = 7) => {
    try {
      const response = await fetch(`/api/stats/${userId}/summary?days=${days}`);
      return await response.json();
    } catch {
      return null;
    }
  }, [userId]);

  const requestWeeklyReport = useCallback(async (email: string) => {
    try {
      const response = await fetch(`/api/stats/${userId}/weekly-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      return await response.json();
    } catch {
      return null;
    }
  }, [userId]);

  return {
    reportBackgroundStart,
    reportGesture,
    getSummary,
    requestWeeklyReport
  };
}
