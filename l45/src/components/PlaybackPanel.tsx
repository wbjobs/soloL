import { usePlaybackStore } from '@/store/playbackStore';
import { Play, Pause, Circle, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

export function PlaybackPanel() {
  const {
    isRecording,
    isPlaying,
    currentFrame,
    totalFrames,
    keyframes,
    playbackSpeed,
    startRecording,
    stopRecording,
    startPlayback,
    stopPlayback,
    setCurrentFrame,
    setPlaybackSpeed,
    clearRecording,
  } = usePlaybackStore();

  const hasRecording = keyframes.length > 0;

  return (
    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
      <div className="bg-slate-900/90 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isPlaying}
              className={`p-2 rounded-lg transition-all ${
                isRecording
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={isRecording ? '停止录制' : '开始录制'}
            >
              <Circle className={`w-5 h-5 ${isRecording ? 'fill-red-400 animate-pulse' : ''}`} />
            </button>

            <button
              onClick={isPlaying ? stopPlayback : startPlayback}
              disabled={!hasRecording || isRecording}
              className={`p-2 rounded-lg transition-all ${
                isPlaying
                  ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
                  : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={isPlaying ? '暂停播放' : '开始回放'}
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>

            <button
              onClick={clearRecording}
              disabled={!hasRecording || isRecording || isPlaying}
              className="p-2 rounded-lg bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="清除录制"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>

          <div className="h-8 w-px bg-slate-700" />

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentFrame(Math.max(0, currentFrame - 10))}
              disabled={!hasRecording || isPlaying}
              className="p-1 rounded bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="w-48">
              <input
                type="range"
                min={0}
                max={totalFrames}
                value={currentFrame}
                onChange={(e) => setCurrentFrame(Number(e.target.value))}
                disabled={!hasRecording || isPlaying}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
              />
            </div>

            <button
              onClick={() => setCurrentFrame(Math.min(totalFrames, currentFrame + 10))}
              disabled={!hasRecording || isPlaying}
              className="p-1 rounded bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="h-8 w-px bg-slate-700" />

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">速度:</span>
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="bg-slate-700/50 text-slate-300 text-xs px-2 py-1 rounded border border-slate-600 focus:outline-none focus:border-cyan-500"
            >
              <option value={0.25}>0.25x</option>
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </div>

          <div className="text-xs text-slate-400 font-mono">
            {isRecording ? (
              <span className="text-red-400">● REC {keyframes.length}kf</span>
            ) : isPlaying ? (
              <span className="text-cyan-400">▶ {currentFrame}/{totalFrames}</span>
            ) : (
              <span>{currentFrame}/{totalFrames}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
