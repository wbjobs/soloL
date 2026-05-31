import React, { memo, useCallback } from 'react';
import { Button, Space } from 'antd';
import {
  MinusOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type { ProofreadBlock } from '../../types';
import { formatSrtTime } from '../../utils';
import { moveTimeline } from '../../api/proofread';
import { useProofreadStore } from '../../stores/proofread-store';

interface TimelineAdjusterProps {
  block: ProofreadBlock;
}

const STEP = 0.1;

export const TimelineAdjuster: React.FC<TimelineAdjusterProps> = memo(({ block }) => {
  const updateBlockInStore = useProofreadStore((s) => s.updateBlock);

  const adjustTime = useCallback(
    async (field: 'startTime' | 'endTime', delta: number) => {
      const newValue = Math.max(0, block[field] + delta);

      if (field === 'startTime' && newValue >= block.endTime) return;
      if (field === 'endTime' && newValue <= block.startTime) return;

      try {
        await moveTimeline({
          blockId: block.id,
          [field]: newValue,
        });
        updateBlockInStore(block.id, { [field]: newValue });
      } catch (err) {
        console.error('Failed to adjust timeline:', err);
      }
    },
    [block, updateBlockInStore],
  );

  return (
    <div className="timeline-adjuster">
      <div className="timeline-adjuster__row">
        <span className="timeline-adjuster__label">Start:</span>
        <Space size={4}>
          <Button
            icon={<MinusOutlined />}
            size="small"
            onClick={() => adjustTime('startTime', -STEP)}
          />
          <span className="timeline-adjuster__value">
            {formatSrtTime(block.startTime)}
          </span>
          <Button
            icon={<PlusOutlined />}
            size="small"
            onClick={() => adjustTime('startTime', STEP)}
          />
        </Space>
      </div>
      <div className="timeline-adjuster__row">
        <span className="timeline-adjuster__label">End:</span>
        <Space size={4}>
          <Button
            icon={<MinusOutlined />}
            size="small"
            onClick={() => adjustTime('endTime', -STEP)}
          />
          <span className="timeline-adjuster__value">
            {formatSrtTime(block.endTime)}
          </span>
          <Button
            icon={<PlusOutlined />}
            size="small"
            onClick={() => adjustTime('endTime', STEP)}
          />
        </Space>
      </div>
    </div>
  );
});

TimelineAdjuster.displayName = 'TimelineAdjuster';
