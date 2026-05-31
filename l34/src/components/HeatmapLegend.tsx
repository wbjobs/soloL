import { useStore } from '@/store/useStore';
import { temperatureToColor } from '@/utils/heatmap';

export default function HeatmapLegend() {
  const simResult = useStore((s) => s.simResult);

  if (!simResult) return null;

  const { min_temp, max_temp } = simResult;
  const steps = 20;

  const gradientStops: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const temp = min_temp + t * (max_temp - min_temp);
    const [r, g, b] = temperatureToColor(temp, min_temp, max_temp);
    gradientStops.push(`rgb(${r},${g},${b}) ${t * 100}%`);
  }

  return (
    <div className="absolute bottom-4 right-4 bg-[rgba(13,27,42,0.85)] border border-[rgba(0,245,212,0.2)] rounded-lg px-2 py-2 pointer-events-none flex gap-2">
      <div className="flex flex-col items-center">
        <div className="text-[10px] font-mono text-[var(--text-secondary)] mb-1">
          °C
        </div>
        <div
          className="w-3 rounded-sm"
          style={{
            height: 100,
            background: `linear-gradient(to top, ${gradientStops.join(', ')})`,
          }}
        />
      </div>
      <div className="flex flex-col justify-between h-[100px]">
        <span className="text-[9px] font-mono text-red-400 leading-none">
          {max_temp.toFixed(0)}
        </span>
        <span className="text-[9px] font-mono text-green-400 leading-none">
          {((min_temp + max_temp) / 2).toFixed(0)}
        </span>
        <span className="text-[9px] font-mono text-blue-400 leading-none">
          {min_temp.toFixed(0)}
        </span>
      </div>
    </div>
  );
}
