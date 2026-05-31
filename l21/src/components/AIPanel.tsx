import { useState, useEffect } from 'react';
import { ChordRecommendation, recommendChords, insertChordToABC } from '../services/chordAI.js';

interface AIPanelProps {
  abcContent: string;
  selectedLine: number | null;
  onInsertChord: (newContent: string) => void;
  disabled?: boolean;
}

export default function AIPanel({ abcContent, selectedLine, onInsertChord, disabled }: AIPanelProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recommendations, setRecommendations] = useState<ChordRecommendation[]>([]);
  const [style, setStyle] = useState<'classical' | 'pop' | 'jazz' | 'blues'>('pop');
  const [selectedChord, setSelectedChord] = useState<string | null>(null);

  useEffect(() => {
    if (selectedLine !== null && !disabled) {
      analyzeMelody();
    } else {
      setRecommendations([]);
    }
  }, [selectedLine, abcContent, style, disabled]);

  const analyzeMelody = async () => {
    if (selectedLine === null) return;

    setIsAnalyzing(true);
    try {
      const startLine = Math.max(0, selectedLine - 1);
      const endLine = Math.min(abcContent.split('\n').length - 1, selectedLine + 1);
      const recs = await recommendChords(abcContent, startLine, endLine, style);
      setRecommendations(recs);
    } catch (error) {
      console.error('Chord analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleInsertChord = (chord: string) => {
    if (selectedLine === null) return;
    const newContent = insertChordToABC(abcContent, selectedLine, chord);
    setSelectedChord(chord);
    onInsertChord(newContent);
  };

  const styleOptions: { value: typeof style; label: string }[] = [
    { value: 'classical', label: '古典' },
    { value: 'pop', label: '流行' },
    { value: 'jazz', label: '爵士' },
    { value: 'blues', label: '蓝调' },
  ];

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-white">AI 和弦配器</h3>
            <p className="text-xs text-slate-400">智能分析旋律推荐和弦</p>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-xs text-slate-400 mb-2">音乐风格</label>
        <div className="grid grid-cols-4 gap-1">
          {styleOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStyle(opt.value)}
              className={`px-2 py-1.5 text-xs rounded-md transition-colors ${
                style === opt.value
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {disabled ? (
        <div className="text-center py-8 text-slate-400">
          <p className="text-sm">该小节已被其他用户锁定</p>
          <p className="text-xs mt-1">无法添加和弦</p>
        </div>
      ) : selectedLine === null ? (
        <div className="text-center py-8 text-slate-400">
          <p className="text-sm">点击乐谱中的行选择小节</p>
          <p className="text-xs mt-1">然后 AI 会分析并推荐和弦</p>
        </div>
      ) : isAnalyzing ? (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400">AI 正在分析旋律...</p>
        </div>
      ) : recommendations.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <p className="text-sm">未找到合适的和弦建议</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-slate-400 mb-2">
            推荐 3 个和弦进行（按匹配度排序）
          </div>
          {recommendations.map((rec, index) => (
            <button
              key={index}
              onClick={() => handleInsertChord(rec.chord)}
              className={`w-full p-3 rounded-lg border transition-all text-left ${
                selectedChord === rec.chord
                  ? 'border-purple-500 bg-purple-500/20'
                  : 'border-slate-600 bg-slate-700/50 hover:border-purple-500/50 hover:bg-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
                    <span className="font-bold text-white text-sm">{rec.chord}</span>
                  </div>
                  <div>
                    <div className="font-medium text-white">{rec.chord}</div>
                    <div className="text-xs text-slate-400">
                      和声匹配度: {Math.round(rec.harmonicFit * 100)}%
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-2 bg-slate-600 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all"
                      style={{ width: `${rec.probability * 100}%` }}
                    />
                  </div>
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
              </div>
            </button>
          ))}

          <div className="mt-4 pt-4 border-t border-slate-700">
            <div className="text-xs text-slate-500 mb-2">构成音</div>
            <div className="flex flex-wrap gap-1">
              {recommendations[0]?.voiceLeading.map((note, i) => (
                <span key={i} className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs">
                  {note}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
