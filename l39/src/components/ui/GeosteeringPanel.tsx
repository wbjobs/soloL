import { useEffect, useState } from 'react';
import { GeosteeringInfo, Point3D } from '../../../shared/types';
import { geosteeringAPI } from '../../utils/api';

interface GeosteeringPanelProps {
  gridId: string;
  currentPoint: Point3D | null;
  isVisible: boolean;
}

export function GeosteeringPanel({ gridId, currentPoint, isVisible }: GeosteeringPanelProps) {
  const [info, setInfo] = useState<GeosteeringInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!gridId || !currentPoint || !isVisible) {
      setInfo(null);
      return;
    }

    const fetchInfo = async () => {
      setLoading(true);
      try {
        const result = await geosteeringAPI.getGeosteeringInfo(gridId, currentPoint);
        setInfo(result);
      } catch (error) {
        console.error('Failed to fetch geosteering info:', error);
        setInfo(null);
      } finally {
        setLoading(false);
      }
    };

    fetchInfo();
  }, [gridId, currentPoint, isVisible]);

  if (!isVisible) return null;

  const getStatusColor = () => {
    if (!info) return 'border-gray-600';
    if (info.targetZone) {
      if (info.distanceToTop < 5 || info.distanceToBottom < 5) {
        return 'border-yellow-500';
      }
      return 'border-green-500';
    }
    if (info.distanceToTop > -10 && info.distanceToTop < 0) {
      return 'border-yellow-500';
    }
    return 'border-red-500';
  };

  const getStatusBg = () => {
    if (!info) return 'bg-gray-800';
    if (info.targetZone) {
      if (info.distanceToTop < 5 || info.distanceToBottom < 5) {
        return 'bg-yellow-900/30';
      }
      return 'bg-green-900/30';
    }
    if (info.distanceToTop > -10 && info.distanceToTop < 0) {
      return 'bg-yellow-900/30';
    }
    return 'bg-red-900/30';
  };

  return (
    <div className={`absolute top-4 left-1/2 transform -translate-x-1/2 z-10 w-96 ${getStatusBg()} border ${getStatusColor()} rounded-lg shadow-lg backdrop-blur-sm`}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">地质导向</h3>
          {loading && (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
          )}
        </div>

        {info ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-gray-700/50 rounded p-2">
                <div className="text-gray-400 text-xs">当前地层</div>
                <div className="text-white font-medium">{info.currentFormation}</div>
              </div>
              <div className="bg-gray-700/50 rounded p-2">
                <div className="text-gray-400 text-xs">目标状态</div>
                <div className={`font-medium ${info.targetZone ? 'text-green-400' : 'text-red-400'}`}>
                  {info.targetZone ? '在目标区' : '不在目标区'}
                </div>
              </div>
            </div>

            <div className="bg-gray-700/50 rounded p-3">
              <div className="text-gray-400 text-xs mb-2">储层边界</div>
              <div className="flex justify-between text-sm">
                <div>
                  <span className="text-gray-400">顶界：</span>
                  <span className="text-white">{info.reservoirTop.toFixed(1)} m</span>
                </div>
                <div>
                  <span className="text-gray-400">底界：</span>
                  <span className="text-white">{info.reservoirBottom.toFixed(1)} m</span>
                </div>
              </div>
              <div className="mt-2 h-2 bg-gray-600 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-500 transition-all"
                  style={{ 
                    width: `${Math.max(0, Math.min(100, 
                      ((info.reservoirBottom - (info.distanceToTop < 0 ? info.reservoirTop : info.reservoirTop + info.distanceToTop)) / 
                       info.formationThickness) * 100
                    ))}%` 
                  }}
                ></div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-gray-700/50 rounded p-2">
                <div className="text-gray-400 text-xs">距顶界</div>
                <div className={`font-medium ${info.distanceToTop >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                  {info.distanceToTop >= 0 ? '+' : ''}{info.distanceToTop.toFixed(1)} m
                </div>
              </div>
              <div className="bg-gray-700/50 rounded p-2">
                <div className="text-gray-400 text-xs">距底界</div>
                <div className={`font-medium ${info.distanceToBottom >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                  {info.distanceToBottom >= 0 ? '+' : ''}{info.distanceToBottom.toFixed(1)} m
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-gray-700/50 rounded p-2">
                <div className="text-gray-400 text-xs">地层厚度</div>
                <div className="text-white font-medium">{info.formationThickness.toFixed(1)} m</div>
              </div>
              <div className="bg-gray-700/50 rounded p-2">
                <div className="text-gray-400 text-xs">地层倾角</div>
                <div className="text-white font-medium">{info.dipAngle.toFixed(1)}°</div>
              </div>
            </div>

            <div className={`rounded p-3 ${info.targetZone ? 'bg-green-800/30 border border-green-600' : 'bg-yellow-800/30 border border-yellow-600'}`}>
              <div className="text-xs text-gray-400 mb-1">导向建议</div>
              <div className="text-white text-sm">{info.recommendation}</div>
            </div>
          </div>
        ) : (
          <div className="text-gray-400 text-center py-4">
            {loading ? '加载中...' : '无法获取地质导向信息'}
          </div>
        )}
      </div>
    </div>
  );
}
