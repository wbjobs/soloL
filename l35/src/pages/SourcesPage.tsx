import { useEffect, useState, useRef } from "react";
import { useStore } from "@/store/useStore";
import type { VideoSource } from "@/types";
import {
  Plus,
  Upload,
  Link,
  Trash2,
  Video,
  Wifi,
  WifiOff,
  AlertCircle,
  Loader2,
} from "lucide-react";

export default function SourcesPage() {
  const sources = useStore((s) => s.sources);
  const fetchSources = useStore((s) => s.fetchSources);
  const [showAdd, setShowAdd] = useState<"file" | "rtsp" | null>(null);
  const [rtspName, setRtspName] = useState("");
  const [rtspUrl, setRtspUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("video", file);
    try {
      await fetch("/api/sources/file", { method: "POST", body: formData });
      fetchSources();
      setShowAdd(null);
    } catch {}
  };

  const handleRtspSubmit = async () => {
    if (!rtspName || !rtspUrl) return;
    try {
      await fetch("/api/sources/rtsp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: rtspName, url: rtspUrl }),
      });
      fetchSources();
      setShowAdd(null);
      setRtspName("");
      setRtspUrl("");
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/sources/${id}`, { method: "DELETE" });
      fetchSources();
    } catch {}
  };

  const statusIcon = (status: VideoSource["status"]) => {
    switch (status) {
      case "live":
        return <Wifi className="h-4 w-4 text-[#00E5A0]" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-[#FF3D71]" />;
      case "connecting":
        return <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />;
      default:
        return <WifiOff className="h-4 w-4 text-[#64748B]" />;
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#E2E8F0]">视频源管理</h1>
            <p className="text-sm text-[#64748B]">
              上传视频文件或配置RTSP流地址
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAdd("file")}
              className="flex items-center gap-1.5 rounded-lg border border-[#00E5A0] bg-[#00E5A0]/10 px-3 py-2 text-sm text-[#00E5A0] transition-colors hover:bg-[#00E5A0]/20"
            >
              <Upload className="h-4 w-4" />
              上传视频
            </button>
            <button
              onClick={() => setShowAdd("rtsp")}
              className="flex items-center gap-1.5 rounded-lg border border-[#2A3040] bg-[#1A1F2E] px-3 py-2 text-sm text-[#E2E8F0] transition-colors hover:bg-[#2A3040]"
            >
              <Link className="h-4 w-4" />
              添加RTSP
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/avi,video/x-matroska"
          className="hidden"
          onChange={handleFileUpload}
        />

        {showAdd === "file" && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="mb-6 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#2A3040] bg-[#1A1F2E] p-8 transition-colors hover:border-[#00E5A0]/50 hover:bg-[#0A0E17]"
          >
            <Upload className="mb-2 h-8 w-8 text-[#64748B]" />
            <span className="text-sm text-[#64748B]">
              拖拽或点击上传视频文件
            </span>
            <span className="text-xs text-[#64748B]">
              支持 MP4 / AVI / MKV 格式
            </span>
          </div>
        )}

        {showAdd === "rtsp" && (
          <div className="mb-6 rounded-lg border border-[#2A3040] bg-[#1A1F2E] p-4">
            <h3 className="mb-3 text-sm font-medium text-[#E2E8F0]">
              配置RTSP流
            </h3>
            <div className="space-y-3">
              <input
                value={rtspName}
                onChange={(e) => setRtspName(e.target.value)}
                placeholder="视频源名称"
                className="w-full rounded border border-[#2A3040] bg-[#0A0E17] px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:border-[#00E5A0] focus:outline-none"
              />
              <input
                value={rtspUrl}
                onChange={(e) => setRtspUrl(e.target.value)}
                placeholder="rtsp://..."
                className="w-full rounded border border-[#2A3040] bg-[#0A0E17] px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:border-[#00E5A0] focus:outline-none"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleRtspSubmit}
                  className="rounded bg-[#00E5A0] px-4 py-1.5 text-sm text-[#0A0E17] font-medium hover:bg-[#00E5A0]/80"
                >
                  添加
                </button>
                <button
                  onClick={() => setShowAdd(null)}
                  className="rounded bg-[#2A3040] px-4 py-1.5 text-sm text-[#E2E8F0] hover:bg-[#2A3040]/80"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {sources.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-[#64748B]">
              <Video className="mb-3 h-12 w-12" />
              <span className="text-sm">暂无视频源</span>
            </div>
          )}
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-4 rounded-lg border border-[#2A3040] bg-[#1A1F2E] p-4 transition-colors hover:bg-[#2A3040]/50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded bg-[#0A0E17]">
                {source.type === "file" ? (
                  <Video className="h-5 w-5 text-[#64748B]" />
                ) : (
                  <Link className="h-5 w-5 text-[#64748B]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#E2E8F0]">
                    {source.name}
                  </span>
                  <span className="rounded bg-[#0A0E17] px-1.5 py-0.5 text-[10px] text-[#64748B]">
                    {source.type.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {statusIcon(source.status)}
                  <span className="text-xs text-[#64748B]">
                    {source.resolution || "—"}
                  </span>
                  {source.bitrate && (
                    <span className="text-xs text-[#64748B]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      {(source.bitrate / 1000).toFixed(0)} kbps
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(source.id)}
                className="rounded p-2 text-[#64748B] transition-colors hover:bg-[#FF3D71]/10 hover:text-[#FF3D71]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
