import React, { memo, useEffect } from 'react';
import { useVideoPlayer } from '../../hooks/useVideoPlayer';
import { PlaybackControls } from './PlaybackControls';
import { usePlayerStore } from '../../stores/player-store';
import { useProofreadStore } from '../../stores/proofread-store';
import 'video.js/dist/video-js.css';

interface VideoPlayerProps {
  src: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = memo(({ src }) => {
  const {
    videoRef,
    seekTo,
    seekToBlock,
    play,
    pause,
    setRate,
    playBlockOnly,
    playNextBlock,
    playPrevBlock,
  } = useVideoPlayer({ src });

  const setSeekToCallback = usePlayerStore((s) => s.setSeekToCallback);
  const activeBlockIndex = usePlayerStore((s) => s.activeBlockIndex);
  const loopCurrentBlock = usePlayerStore((s) => s.loopCurrentBlock);
  const setLoopCurrentBlock = usePlayerStore((s) => s.setLoopCurrentBlock);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const blocks = useProofreadStore((s) => s.blocks);

  useEffect(() => {
    setSeekToCallback(seekTo);
    return () => setSeekToCallback(null);
  }, [seekTo, setSeekToCallback]);

  const activeBlock = activeBlockIndex >= 0 && activeBlockIndex < blocks.length
    ? blocks[activeBlockIndex]
    : null;

  const handlePlayCurrentSentence = () => {
    if (activeBlock) {
      playBlockOnly(activeBlock);
    }
  };

  const handleSeekToActive = () => {
    if (activeBlock) {
      seekToBlock(activeBlock);
      play();
    }
  };

  return (
    <div className="video-player-container">
      <div data-vjs-player>
        <video
          ref={videoRef}
          className="video-js vjs-big-play-centered vjs-fluid"
        />
      </div>
      <PlaybackControls
        isPlaying={isPlaying}
        playbackRate={playbackRate}
        loopCurrentBlock={loopCurrentBlock}
        onPlay={play}
        onPause={pause}
        onSetRate={setRate}
        onPlayCurrentSentence={handlePlayCurrentSentence}
        onSeekToActive={handleSeekToActive}
        onPrev={playPrevBlock}
        onNext={playNextBlock}
        onToggleLoop={() => setLoopCurrentBlock(!loopCurrentBlock)}
        hasActiveBlock={!!activeBlock}
      />
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';
