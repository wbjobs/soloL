import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Users, Play, Plus, ArrowRight, Sparkles } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { generateUserId } from '../utils/abcUtils';

export default function HomePage() {
  const navigate = useNavigate();
  const [createRoomName, setCreateRoomName] = useState('');
  const [createUserName, setCreateUserName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinUserName, setJoinUserName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createRoomName.trim() || !createUserName.trim()) return;

    setIsCreating(true);
    try {
      const roomId = uuidv4().split('-')[0];
      const userId = generateUserId();

      localStorage.setItem('userId', userId);
      localStorage.setItem('userName', createUserName.trim());

      navigate(`/room/${roomId}`);
    } catch (error) {
      console.error('Failed to create room:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinRoomId.trim() || !joinUserName.trim()) return;

    setIsJoining(true);
    try {
      const userId = generateUserId();

      localStorage.setItem('userId', userId);
      localStorage.setItem('userName', joinUserName.trim());

      navigate(`/room/${joinRoomId.trim()}`);
    } catch (error) {
      console.error('Failed to join room:', error);
    } finally {
      setIsJoining(false);
    }
  };

  const handleDemoMode = () => {
    const userId = generateUserId();
    localStorage.setItem('userId', userId);
    localStorage.setItem('userName', '演示用户');
    navigate('/demo');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-indigo-900 to-amber-900 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-amber-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl animate-pulse delay-500" />
      </div>

      <div className="relative z-10 container mx-auto px-4 py-8 md:py-16">
        <header className="text-center mb-12 md:mb-20 animate-fade-in">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-14 h-14 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Music className="w-8 h-8 text-white" />
            </div>
            <h1 className="font-display text-4xl md:text-6xl font-bold text-white tracking-tight">
              协同乐谱编辑器
            </h1>
          </div>
          <p className="font-mono text-lg md:text-xl text-indigo-200 max-w-2xl mx-auto leading-relaxed">
            基于 WebRTC 的实时多人协作乐谱编辑平台
            <br />
            支持 ABC 记谱法 · MIDI 实时预览 · 版本历史管理
          </p>
        </header>

        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-8 mb-12">
          <div className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 shadow-2xl animate-slide-up hover:bg-white/10 transition-all duration-500 group">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                <Plus className="w-6 h-6 text-white" />
              </div>
              <h2 className="font-display text-2xl font-bold text-white">创建新房间</h2>
            </div>

            <form onSubmit={handleCreateRoom} className="space-y-5">
              <div>
                <label className="block font-mono text-sm text-indigo-300 mb-2">房间名称</label>
                <input
                  type="text"
                  value={createRoomName}
                  onChange={(e) => setCreateRoomName(e.target.value)}
                  placeholder="输入房间名称..."
                  className="w-full px-5 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-indigo-400/60 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all duration-300"
                />
              </div>
              <div>
                <label className="block font-mono text-sm text-indigo-300 mb-2">您的用户名</label>
                <input
                  type="text"
                  value={createUserName}
                  onChange={(e) => setCreateUserName(e.target.value)}
                  placeholder="输入您的用户名..."
                  className="w-full px-5 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-indigo-400/60 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all duration-300"
                />
              </div>
              <button
                type="submit"
                disabled={isCreating || !createRoomName.trim() || !createUserName.trim()}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-display font-semibold text-lg rounded-xl shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 transition-all duration-300 flex items-center justify-center gap-2 group-hover:scale-[1.02] active:scale-[0.98]"
              >
                {isCreating ? '创建中...' : '创建房间'}
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          </div>

          <div className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 shadow-2xl animate-slide-up delay-150 hover:bg-white/10 transition-all duration-500 group">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                <Users className="w-6 h-6 text-white" />
              </div>
              <h2 className="font-display text-2xl font-bold text-white">加入房间</h2>
            </div>

            <form onSubmit={handleJoinRoom} className="space-y-5">
              <div>
                <label className="block font-mono text-sm text-indigo-300 mb-2">房间 ID</label>
                <input
                  type="text"
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value)}
                  placeholder="输入房间 ID..."
                  className="w-full px-5 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-indigo-400/60 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all duration-300"
                />
              </div>
              <div>
                <label className="block font-mono text-sm text-indigo-300 mb-2">您的用户名</label>
                <input
                  type="text"
                  value={joinUserName}
                  onChange={(e) => setJoinUserName(e.target.value)}
                  placeholder="输入您的用户名..."
                  className="w-full px-5 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-indigo-400/60 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all duration-300"
                />
              </div>
              <button
                type="submit"
                disabled={isJoining || !joinRoomId.trim() || !joinUserName.trim()}
                className="w-full py-4 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-display font-semibold text-lg rounded-xl shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 transition-all duration-300 flex items-center justify-center gap-2 group-hover:scale-[1.02] active:scale-[0.98]"
              >
                {isJoining ? '加入中...' : '加入房间'}
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          </div>
        </div>

        <div className="max-w-2xl mx-auto animate-slide-up delay-300">
          <button
            onClick={handleDemoMode}
            className="w-full py-6 bg-gradient-to-r from-rose-500/20 via-amber-500/20 to-emerald-500/20 hover:from-rose-500/30 hover:via-amber-500/30 hover:to-emerald-500/30 border border-white/20 backdrop-blur-xl rounded-2xl transition-all duration-500 group hover:scale-[1.02] active:scale-[0.98]"
          >
            <div className="flex items-center justify-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-rose-500 via-amber-500 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg animate-pulse group-hover:animate-none group-hover:scale-110 transition-transform duration-300">
                <Sparkles className="w-7 h-7 text-white" />
              </div>
              <div className="text-left">
                <h3 className="font-display text-2xl font-bold text-white flex items-center gap-2">
                  快速演示模式
                  <Play className="w-5 h-5 text-amber-400" />
                </h3>
                <p className="font-mono text-indigo-300 mt-1">
                  无需网络连接，体验完整编辑器功能
                </p>
              </div>
            </div>
          </button>
        </div>

        <footer className="mt-20 text-center animate-fade-in delay-500">
          <div className="flex flex-wrap justify-center gap-8 mb-6">
            <div className="flex items-center gap-2 text-indigo-300 font-mono text-sm">
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
              WebRTC 点对点连接
            </div>
            <div className="flex items-center gap-2 text-indigo-300 font-mono text-sm">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse delay-300" />
              实时协作编辑
            </div>
            <div className="flex items-center gap-2 text-indigo-300 font-mono text-sm">
              <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse delay-500" />
              MIDI 实时预览
            </div>
          </div>
          <p className="font-mono text-sm text-indigo-400/60">
            © 2024 协同乐谱编辑器 · 使用 ABC 记谱法
          </p>
        </footer>
      </div>
    </div>
  );
}
