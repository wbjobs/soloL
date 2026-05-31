import React, { memo, useCallback } from 'react';
import { Button, Select, Tooltip, Space } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';

interface PlaybackControlsProps {
  isPlaying: boolean;
  playbackRate: number;
  loopCurrentBlock: boolean;
  hasActiveBlock: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSetRate: (rate: number) => void;
  onPlayCurrentSentence: () => void;
  onSeekToActive: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleLoop: () => void;
}

const PLAYBACK_RATES = [
  { value: 0.5, label: '0.5x' },
  { value: 0.75, label: '0.75x' },
  { value: 1, label: '1x' },
  { value: 1.25, label: '1.25x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
];

export const PlaybackControls: React.FC<PlaybackControlsProps> = memo(
  ({
    isPlaying,
    playbackRate,
    loopCurrentBlock,
    hasActiveBlock,
    onPlay,
    onPause,
    onSetRate,
    onPlayCurrentSentence,
    onSeekToActive,
    onPrev,
    onNext,
    onToggleLoop,
  }) => {
    const handleRateChange = useCallback(
      (value: number) => {
        onSetRate(value);
      },
      [onSetRate],
    );

    return (
      <div className="playback-controls">
        <Space size="small">
          <Tooltip title="Previous sentence">
            <Button
              icon={<StepBackwardOutlined />}
              onClick={onPrev}
              disabled={!hasActiveBlock}
              size="small"
            />
          </Tooltip>

          <Tooltip title={isPlaying ? 'Pause' : 'Play'}>
            <Button
              icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={isPlaying ? onPause : onPlay}
              size="small"
            />
          </Tooltip>

          <Tooltip title="Next sentence">
            <Button
              icon={<StepForwardOutlined />}
              onClick={onNext}
              disabled={!hasActiveBlock}
              size="small"
            />
          </Tooltip>

          <Tooltip title="Play current sentence only">
            <Button
              icon={<PlayCircleOutlined />}
              onClick={onPlayCurrentSentence}
              disabled={!hasActiveBlock}
              size="small"
            >
              Sentence
            </Button>
          </Tooltip>

          <Tooltip title="Seek to active sentence">
            <Button
              icon={<ReloadOutlined />}
              onClick={onSeekToActive}
              disabled={!hasActiveBlock}
              size="small"
            />
          </Tooltip>

          <Tooltip title={loopCurrentBlock ? 'Loop: ON' : 'Loop: OFF'}>
            <Button
              icon={<SyncOutlined />}
              onClick={onToggleLoop}
              type={loopCurrentBlock ? 'primary' : 'default'}
              disabled={!hasActiveBlock}
              size="small"
            >
              Loop
            </Button>
          </Tooltip>

          <Select
            size="small"
            value={playbackRate}
            onChange={handleRateChange}
            options={PLAYBACK_RATES}
            style={{ width: 80 }}
          />
        </Space>
      </div>
    );
  },
);

PlaybackControls.displayName = 'PlaybackControls';
