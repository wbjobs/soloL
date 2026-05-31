import { useEffect, useRef, useCallback } from 'react';
import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import { usePlayerStore } from '../stores/player-store';
import { useProofreadStore } from '../stores/proofread-store';
import type { ProofreadBlock } from '../types';

interface UseVideoPlayerOptions {
  src: string;
  onReady?: (player: Player) => void;
}

export function useVideoPlayer(options: UseVideoPlayerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);
  const {
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setPlaybackRate,
    activeBlockIndex,
    loopCurrentBlock,
  } = usePlayerStore();
  const blocks = useProofreadStore((s) => s.blocks);

  const syncActiveBlock = useCallback(() => {
    const time = usePlayerStore.getState().currentTime;
    const currentBlocks = useProofreadStore.getState().blocks;
    for (let i = currentBlocks.length - 1; i >= 0; i--) {
      if (time >= currentBlocks[i].startTime) {
        usePlayerStore.getState().setActiveBlockIndex(i);
        return;
      }
    }
    usePlayerStore.getState().setActiveBlockIndex(0);
  }, []);

  useEffect(() => {
    if (!videoRef.current) return;

    const player = videojs(videoRef.current, {
      controls: true,
      autoplay: false,
      preload: 'auto',
      fluid: true,
      responsive: true,
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
      sources: [
        {
          src: options.src,
          type: options.src.endsWith('.m3u8')
            ? 'application/x-mpegURL'
            : 'video/mp4',
        },
      ],
    });

    playerRef.current = player;

    player.on('loadedmetadata', () => {
      const dur = player.duration();
      if (typeof dur === 'number') {
        setDuration(dur);
      }
    });

    player.on('timeupdate', () => {
      const time = player.currentTime();
      if (typeof time === 'number') {
        setCurrentTime(time);

        if (loopCurrentBlock) {
          const currentBlocks = useProofreadStore.getState().blocks;
          const idx = usePlayerStore.getState().activeBlockIndex;
          if (idx >= 0 && idx < currentBlocks.length) {
            const block = currentBlocks[idx];
            if (time >= block.endTime) {
              player.currentTime(block.startTime);
            }
          }
        }

        syncActiveBlock();
      }
    });

    player.on('play', () => setIsPlaying(true));
    player.on('pause', () => setIsPlaying(false));
    player.on('ratechange', () => {
      const rate = player.playbackRate();
      if (typeof rate === 'number') {
        setPlaybackRate(rate);
      }
    });

    player.ready(() => {
      options.onReady?.(player);
    });

    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, [options.src]);

  const seekTo = useCallback((time: number) => {
    if (playerRef.current) {
      playerRef.current.currentTime(time);
      setCurrentTime(time);
    }
  }, [setCurrentTime]);

  const seekToBlock = useCallback(
    (block: ProofreadBlock) => {
      seekTo(block.startTime);
    },
    [seekTo],
  );

  const play = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.play();
    }
  }, []);

  const pause = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.pause();
    }
  }, []);

  const setRate = useCallback(
    (rate: number) => {
      if (playerRef.current) {
        playerRef.current.playbackRate(rate);
        setPlaybackRate(rate);
      }
    },
    [setPlaybackRate],
  );

  const playBlockOnly = useCallback(
    (block: ProofreadBlock) => {
      if (playerRef.current) {
        playerRef.current.currentTime(block.startTime);
        playerRef.current.play();

        const onTimeUpdate = () => {
          const time = playerRef.current?.currentTime();
          if (typeof time === 'number' && time >= block.endTime) {
            playerRef.current?.pause();
            playerRef.current?.off('timeupdate', onTimeUpdate);
          }
        };
        playerRef.current.on('timeupdate', onTimeUpdate);
      }
    },
    [],
  );

  const playNextBlock = useCallback(() => {
    const idx = activeBlockIndex;
    if (idx < blocks.length - 1) {
      seekToBlock(blocks[idx + 1]);
      play();
    }
  }, [activeBlockIndex, blocks, seekToBlock, play]);

  const playPrevBlock = useCallback(() => {
    const idx = activeBlockIndex;
    if (idx > 0) {
      seekToBlock(blocks[idx - 1]);
      play();
    }
  }, [activeBlockIndex, blocks, seekToBlock, play]);

  return {
    videoRef,
    playerRef,
    seekTo,
    seekToBlock,
    play,
    pause,
    setRate,
    playBlockOnly,
    playNextBlock,
    playPrevBlock,
  };
}
