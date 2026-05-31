import { cn } from '@/lib/utils';

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  showValue?: boolean;
  className?: string;
}

export default function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  showValue = true,
  className,
}: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={cn('w-full', className)}>
      {(label || showValue) && (
        <div className="flex justify-between items-center mb-2">
          {label && <span className="text-sm text-gray-300">{label}</span>}
          {showValue && (
            <span className="text-sm font-mono text-primary">
              {value.toFixed(step < 1 ? 2 : 0)}
            </span>
          )}
        </div>
      )}
      <div className="relative">
        <div className="absolute inset-0 h-2 bg-surface rounded-lg overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-150"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative w-full h-2 bg-transparent appearance-none cursor-pointer z-10"
        />
      </div>
    </div>
  );
}
