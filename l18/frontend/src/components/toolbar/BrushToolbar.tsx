import { Circle, Square, Wand2, Pencil, Eraser } from 'lucide-react';
import { cn } from '@/lib/utils';
import Button from '../common/Button';
import Slider from '../common/Slider';
import { useAnnotationStore } from '@/store/useAnnotationStore';
import type { BrushShape } from '@/types';

const shapes: { value: BrushShape; icon: React.ReactNode; label: string }[] = [
  { value: 'sphere', icon: <Circle size={18} />, label: '球形画笔' },
  { value: 'cube', icon: <Square size={18} />, label: '立方体画笔' },
];

export default function BrushToolbar() {
  const { brushSettings, setBrushShape, setBrushSize, isBrushActive, setBrushActive } =
    useAnnotationStore();

  return (
    <div className="panel p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">画笔工具</h3>
        <Button
          variant="icon"
          size="sm"
          isActive={isBrushActive}
          onClick={() => setBrushActive(!isBrushActive)}
          title={isBrushActive ? '禁用画笔' : '启用画笔'}
        >
          <Pencil size={16} />
        </Button>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-gray-400">形状</span>
        <div className="flex gap-2">
          {shapes.map((shape) => (
            <Button
              key={shape.value}
              variant="icon"
              size="sm"
              isActive={brushSettings.shape === shape.value}
              onClick={() => setBrushShape(shape.value)}
              title={shape.label}
              className="flex-1"
            >
              {shape.icon}
            </Button>
          ))}
        </div>
      </div>

      <Slider
        label="尺寸"
        value={brushSettings.size}
        onChange={setBrushSize}
        min={0.1}
        max={5}
        step={0.1}
      />

      <div className="pt-2 border-t border-surface-border">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={() => console.log('AI预测')}
        >
          <Wand2 size={16} className="mr-2 text-purple-400" />
          AI 智能预测
        </Button>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Eraser size={14} />
        <span>按住 Shift 擦除</span>
      </div>
    </div>
  );
}
