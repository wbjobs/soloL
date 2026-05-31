import { useState, useCallback } from 'react';
import { UserConfig, BackgroundConfig } from '../types';

export function useConfig(userId: string = 'default') {
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/config/${userId}`);
      const data = await response.json();
      setConfig(data);
      return data;
    } catch (error) {
      console.error('Failed to fetch config:', error);
      return null;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const updateConfig = useCallback(async (updates: Partial<UserConfig>) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/config/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await response.json();
      setConfig(data);
      return data;
    } catch (error) {
      console.error('Failed to update config:', error);
      return null;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const updateBackground = useCallback(async (background: BackgroundConfig) => {
    return updateConfig({ background });
  }, [updateConfig]);

  const updateAvatar = useCallback(async (avatar: string) => {
    return updateConfig({ avatar });
  }, [updateConfig]);

  return {
    config,
    loading,
    fetchConfig,
    updateConfig,
    updateBackground,
    updateAvatar
  };
}
