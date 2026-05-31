import { useCallback, useMemo, useRef, useState } from 'react';
import { Play, Pause, Square, Volume2, VolumeX, Gauge, Music } from 'lucide-react';
import { useCollaborationStore } from '../store/useCollaborationStore';
import { useEditorStore, useIsPlaying, usePlayPosition, usePlaybackSpeed } from '../store/useEditorStore';
import { useMIDIPlayer } from '../hooks/useMIDIPlayer';
import { useWebRTC } from '../hooks/useWebRTC';
import { cn } from '../lib/utils';

interface PlaybackControlsProps {
  className?: string;
  roomId?: string;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function PlaybackControls({ className, roomId }: PlaybackControlsProps) {
  const { content, currentUser } = useCollaborationStore();
  const { setPlaying, setPlayPosition, setPlaybackSpeed, setVolume } = useEditorStore();
  const isPlaying = useIsPlaying();
  const playPosition = usePlayPosition();
  const playbackSpeed = usePlaybackSpeed();

  const { sendMidiPlay, sendMidiStop, sendMidiSeek } = useWebRTC({
    userId: currentUser?.id || '',
    roomId: roomId || '',
  });

  const { playbackState, notes, play, pause, stop, seek, setPlaybackSpeed: setMIDISpeed } = useMIDIPlayer({
    abcContent: content,
    onPlay: () => {
      setPlaying(true);
      sendMidiPlay(playPosition || 0);
    },
    onPause: () => {
      setPlaying(false);
      sendMidiStop();
    },
    onStop: () => {
      setPlaying(false);
      setPlayPosition(0);
      sendMidiStop();
    },
    onSeek: (noteIndex) => {
      setPlayPosition(noteIndex);
      sendMidiSeek(noteIndex);
    },
    onComplete: () => {
      setPlaying(false);
      setPlayPosition(0);
      sendMidiStop();
    },
    onSpeedChange: (speed) => {
      setPlaybackSpeed(speed);
    },
  });

  const [volume, setLocalVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const progress = useMemo(() => {
    if (notes.length === 0) return 0;
    return (playPosition / (notes.length - 1 || 1)) * 100;
  }, [playPosition, notes.length]);

  const currentNote = notes[playPosition];
  const nextNote = notes[playPosition + 1];

  const handlePlayPause = useCallback(async () => {
    if (isPlaying) {
      pause();
    } else {
      await play(playPosition);
    }
  }, [isPlaying, pause, play, playPosition]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || notes.length === 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const noteIndex = Math.round(percentage * (notes.length - 1));
    seek(noteIndex);
  }, [notes.length, seek]);

  const handleProgressMouseDown = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleProgressMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !progressRef.current || notes.length === 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const noteIndex = Math.round(percentage * (notes.length - 1));
    setPlayPosition(noteIndex);
  }, [notes.length, setPlayPosition]);

  const handleProgressMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !progressRef.current || notes.length === 0) return;
    isDraggingRef.current = false;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const noteIndex = Math.round(percentage * (notes.length - 1));
    seek(noteIndex);
  }, [notes.length, seek]);

  const handleSpeedChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const speed = parseFloat(e.target.value);
    setMIDISpeed(speed);
  }, [setMIDISpeed]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setLocalVolume(vol);
    setVolume(vol);
    setIsMuted(vol === 0);
  }, [setVolume]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
    setVolume(isMuted ? volume : 0);
  }, [isMuted, volume, setVolume]);

  return (
    <div className={cn('rounded-lg border border-gray-200 bg-white p-4', className)}>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Music className="h-4 w-4 text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">MIDI 播放</span>
        </div>
        {playbackState.isReady && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            已加载 {notes.length} 个音符
          </span>
        )}
        {playbackState.error && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {playbackState.error}
          </span>
        )}
      </div>

      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
          <span>{formatTime(playbackState.currentTime)}</span>
          <span>{formatTime(playbackState.duration)}</span>
        </div>
        <div
          ref={progressRef}
          className="relative h-2 cursor-pointer rounded-full bg-gray-200 overflow-hidden"
          onClick={handleProgressClick}
          onMouseDown={handleProgressMouseDown}
          onMouseMove={handleProgressMouseMove}
          onMouseUp={handleProgressMouseUp}
          onMouseLeave={() => (isDraggingRef.current = false)}
        >
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-indigo-600 shadow-md transition-all"
            style={{ left: `${progress}%` }}
          />
        </div>
        {currentNote && (
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>当前: {currentNote.note}</span>
            {nextNote && <span>下一个: {nextNote.note}</span>}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePlayPause}
            disabled={!playbackState.isReady}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full transition-all',
              playbackState.isReady
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md hover:shadow-lg'
                : 'cursor-not-allowed bg-gray-200 text-gray-400'
            )}
            title={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
          </button>
          <button
            onClick={handleStop}
            disabled={!playbackState.isReady}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full transition-all',
              playbackState.isReady
                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                : 'cursor-not-allowed bg-gray-100 text-gray-300'
            )}
            title="停止"
          >
            <Square className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-gray-400" />
            <input
              type="range"
              min="0.25"
              max="4"
              step="0.25"
              value={playbackSpeed}
              onChange={handleSpeedChange}
              className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-gray-200 accent-indigo-500"
            />
            <span className="w-10 text-xs font-medium text-gray-600">
              {playbackSpeed}x
            </span>
          </div>

          <div className="h-4 w-px bg-gray-200" />

          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              title={isMuted ? '取消静音' : '静音'}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="h-1.5 w-16 cursor-pointer appearance-none rounded-full bg-gray-200 accent-indigo-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
