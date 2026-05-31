import { useMemo } from "react";
import { useStore } from "@/store/useStore";
import { X, Users, TrendingUp, MapPin } from "lucide-react";

export default function StatsPanel() {
  const statsPanelOpen = useStore((s) => s.statsPanelOpen);
  const toggleStatsPanel = useStore((s) => s.toggleStatsPanel);
  const detections = useStore((s) => s.detections);
  const regions = useStore((s) => s.regions);

  const countHistory = useMemo(() => {
    const base = detections?.count ?? 0;
    if (base === 0) return Array(10).fill(0);
    return Array.from({ length: 10 }, (_, i) =>
      Math.max(0, Math.round(base * (0.7 + 0.3 * Math.sin(i * 0.8))))
    );
  }, [detections?.count]);

  const maxCount = Math.max(...countHistory, 1);

  return (
    <div
      className={`fixed right-0 top-14 z-30 h-[calc(100vh-3.5rem)] w-80 border-l border-[#2A3040] bg-[#1A1F2E] transition-transform duration-300 ${
        statsPanelOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between border-b border-[#2A3040] p-4">
        <h2 className="text-sm font-semibold text-[#E2E8F0]">人流统计</h2>
        <button
          onClick={toggleStatsPanel}
          className="rounded p-1 text-[#64748B] hover:bg-[#2A3040] hover:text-[#E2E8F0]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#0A0E17] shadow-[0_0_12px_rgba(0,229,160,0.2)]">
            <Users className="h-7 w-7 text-[#00E5A0]" />
          </div>
          <div>
            <div className="text-3xl font-bold text-[#00E5A0]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {detections?.count ?? 0}
            </div>
            <div className="text-xs text-[#64748B]">当前人数</div>
          </div>
        </div>

        <div className="mb-6">
          <div className="mb-2 flex items-center gap-1 text-xs text-[#64748B]">
            <TrendingUp className="h-3 w-3" />
            最近趋势
          </div>
          <div className="flex h-20 items-end gap-1">
            {countHistory.map((val, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-[#00E5A0]/60 transition-all"
                style={{ height: `${(val / maxCount) * 100}%` }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-1 text-xs text-[#64748B]">
            <MapPin className="h-3 w-3" />
            布防区域状态
          </div>
          <div className="space-y-2">
            {regions.length === 0 && (
              <div className="text-xs text-[#64748B]">暂无布防区域</div>
            )}
            {regions.map((region) => {
              const regionResult = detections?.regions.find(
                (r) => r.regionId === region.id
              );
              const breached = regionResult?.breached;
              return (
                <div
                  key={region.id}
                  className="flex items-center justify-between rounded bg-[#0A0E17] px-3 py-2"
                >
                  <span className="text-xs text-[#E2E8F0]">{region.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#64748B]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      {regionResult?.insideCount ?? 0}
                    </span>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        breached
                          ? "bg-[#FF3D71] shadow-[0_0_6px_#FF3D71]"
                          : "bg-[#00E5A0] shadow-[0_0_6px_#00E5A0]"
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
