import { useRef, useEffect } from "react";
import { useWebRTC } from "@/hooks/useWebRTC";
import { Monitor } from "lucide-react";

interface VideoPlayerProps {
  sourceId: string | null;
  onVideoFrame?: (videoEl: HTMLVideoElement) => void;
  paused?: boolean;
}

export default function VideoPlayer({ sourceId, onVideoFrame, paused }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { stream, connect, disconnect } = useWebRTC();

  useEffect(() => {
    if (videoRef.current) {
      if (paused) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(() => {});
      }
    }
  }, [paused]);

  useEffect(() => {
    if (sourceId) {
      connect(sourceId);
    } else {
      disconnect();
    }
    return () => disconnect();
  }, [sourceId, connect, disconnect]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (!onVideoFrame || !videoRef.current) return;
    let animId: number;
    const loop = () => {
      if (!paused && videoRef.current && videoRef.current.readyState >= 2) {
        onVideoFrame(videoRef.current);
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [onVideoFrame, paused]);

  const hasStream = stream && stream.getVideoTracks().length > 0;

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black overflow-hidden">
      {hasStream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-contain"
        />
      ) : (
        <canvas
          ref={canvasRef}
          width={1920}
          height={1080}
          className="h-full w-full object-contain"
        />
      )}
      {!hasStream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Monitor className="h-12 w-12 text-[#64748B]" />
          <span className="text-sm text-[#64748B]">
            {sourceId ? "正在连接视频流..." : "未选择视频源"}
          </span>
        </div>
      )}
    </div>
  );
}
