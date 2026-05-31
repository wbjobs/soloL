import { useEffect, useState, useCallback } from "react";
import { useStore } from "@/store/useStore";
import VideoPlayer from "@/components/VideoPlayer";
import PolygonDrawer from "@/components/PolygonDrawer";
import AlertList from "@/components/AlertList";
import type { DefenseRegion } from "@/types";
import {
  Plus,
  Save,
  Trash2,
  Shield,
  ToggleLeft,
  ToggleRight,
  Users,
  Clock,
  ArrowRightLeft,
} from "lucide-react";

interface RegionForm {
  name: string;
  maxPeople: number;
  direction: "in" | "out" | "both";
  scheduleStart: string;
  scheduleEnd: string;
}

export default function DefensePage() {
  const sources = useStore((s) => s.sources);
  const selectedSourceId = useStore((s) => s.selectedSourceId);
  const setSelectedSourceId = useStore((s) => s.setSelectedSourceId);
  const regions = useStore((s) => s.regions);
  const fetchSources = useStore((s) => s.fetchSources);
  const fetchRegions = useStore((s) => s.fetchRegions);
  const alerts = useStore((s) => s.alerts);

  const [drawing, setDrawing] = useState(false);
  const [pendingPolygon, setPendingPolygon] = useState<
    Array<{ x: number; y: number }> | null
  >(null);
  const [form, setForm] = useState<RegionForm>({
    name: "",
    maxPeople: 5,
    direction: "both",
    scheduleStart: "00:00",
    scheduleEnd: "23:59",
  });
  const [dimensions, setDimensions] = useState({ w: 1920, h: 1080 });

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handlePolygonComplete = useCallback(
    (polygon: Array<{ x: number; y: number }>) => {
      setPendingPolygon(polygon);
      setDrawing(false);
    },
    []
  );

  const handleSave = async () => {
    if (!pendingPolygon || !selectedSourceId || !form.name) return;
    const body = {
      sourceId: selectedSourceId,
      name: form.name,
      polygon: pendingPolygon,
      rules: {
        maxPeople: form.maxPeople,
        direction: form.direction,
        schedule: { start: form.scheduleStart, end: form.scheduleEnd },
      },
      enabled: true,
    };
    try {
      await fetch("/api/regions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      fetchRegions(selectedSourceId);
      setPendingPolygon(null);
      setForm({
        name: "",
        maxPeople: 5,
        direction: "both",
        scheduleStart: "00:00",
        scheduleEnd: "23:59",
      });
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!selectedSourceId) return;
    try {
      await fetch(`/api/regions/${id}`, { method: "DELETE" });
      fetchRegions(selectedSourceId);
    } catch {}
  };

  const handleToggle = async (region: DefenseRegion) => {
    if (!selectedSourceId) return;
    try {
      await fetch(`/api/regions/${region.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !region.enabled }),
      });
      fetchRegions(selectedSourceId);
    } catch {}
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[#2A3040] bg-[#1A1F2E] px-4 py-2">
          <select
            value={selectedSourceId || ""}
            onChange={(e) => setSelectedSourceId(e.target.value || null)}
            className="rounded border border-[#2A3040] bg-[#0A0E17] px-3 py-1.5 text-sm text-[#E2E8F0] focus:border-[#00E5A0] focus:outline-none"
          >
            <option value="">选择视频源</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setDrawing(!drawing)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
              drawing
                ? "bg-[#00E5A0]/20 text-[#00E5A0]"
                : "bg-[#0A0E17] text-[#64748B] hover:text-[#E2E8F0]"
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            绘制区域
          </button>
        </div>

        <div
          className="relative flex-1 overflow-hidden"
          onMouseEnter={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setDimensions({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
          }}
        >
          <VideoPlayer sourceId={selectedSourceId} />
          {drawing && selectedSourceId && (
            <PolygonDrawer
              existingRegions={regions}
              onPolygonComplete={handlePolygonComplete}
              width={dimensions.w}
              height={dimensions.h}
            />
          )}
        </div>
      </div>

      <div className="w-80 flex flex-col border-l border-[#2A3040] bg-[#1A1F2E] overflow-y-auto">
        <div className="border-b border-[#2A3040] p-4">
          <h2 className="text-sm font-semibold text-[#E2E8F0]">布防区域</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {pendingPolygon && (
            <div className="rounded-lg border border-[#00E5A0]/30 bg-[#0A0E17] p-3">
              <div className="mb-2 text-xs text-[#00E5A0]">新区域待保存</div>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="区域名称"
                className="mb-2 w-full rounded border border-[#2A3040] bg-[#1A1F2E] px-2 py-1 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:border-[#00E5A0] focus:outline-none"
              />
              <div className="mb-2 flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-[#64748B]" />
                <input
                  type="number"
                  min={1}
                  value={form.maxPeople}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maxPeople: parseInt(e.target.value) || 1 }))
                  }
                  className="w-16 rounded border border-[#2A3040] bg-[#1A1F2E] px-2 py-1 text-xs text-[#E2E8F0] focus:border-[#00E5A0] focus:outline-none"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                />
                <span className="text-xs text-[#64748B]">人上限</span>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <ArrowRightLeft className="h-3.5 w-3.5 text-[#64748B]" />
                <select
                  value={form.direction}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      direction: e.target.value as "in" | "out" | "both",
                    }))
                  }
                  className="rounded border border-[#2A3040] bg-[#1A1F2E] px-2 py-1 text-xs text-[#E2E8F0] focus:border-[#00E5A0] focus:outline-none"
                >
                  <option value="both">双向</option>
                  <option value="in">进入</option>
                  <option value="out">离开</option>
                </select>
              </div>
              <div className="mb-3 flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-[#64748B]" />
                <input
                  type="time"
                  value={form.scheduleStart}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, scheduleStart: e.target.value }))
                  }
                  className="rounded border border-[#2A3040] bg-[#1A1F2E] px-2 py-1 text-xs text-[#E2E8F0] focus:border-[#00E5A0] focus:outline-none"
                />
                <span className="text-xs text-[#64748B]">-</span>
                <input
                  type="time"
                  value={form.scheduleEnd}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, scheduleEnd: e.target.value }))
                  }
                  className="rounded border border-[#2A3040] bg-[#1A1F2E] px-2 py-1 text-xs text-[#E2E8F0] focus:border-[#00E5A0] focus:outline-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1 rounded bg-[#00E5A0] px-3 py-1 text-xs text-[#0A0E17] font-medium hover:bg-[#00E5A0]/80"
                >
                  <Save className="h-3 w-3" />
                  保存
                </button>
                <button
                  onClick={() => setPendingPolygon(null)}
                  className="rounded bg-[#2A3040] px-3 py-1 text-xs text-[#E2E8F0] hover:bg-[#2A3040]/80"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {regions.length === 0 && !pendingPolygon && (
            <div className="flex flex-col items-center justify-center py-8 text-[#64748B]">
              <Shield className="mb-2 h-8 w-8" />
              <span className="text-xs">暂无布防区域</span>
            </div>
          )}

          {regions.map((region) => (
            <div
              key={region.id}
              className="rounded-lg border border-[#2A3040] bg-[#0A0E17] p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[#E2E8F0]">
                  {region.name}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggle(region)}
                    className="text-[#64748B] hover:text-[#00E5A0]"
                  >
                    {region.enabled ? (
                      <ToggleRight className="h-5 w-5 text-[#00E5A0]" />
                    ) : (
                      <ToggleLeft className="h-5 w-5" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(region.id)}
                    className="text-[#64748B] hover:text-[#FF3D71]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-[#64748B]">
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {region.rules.maxPeople}人
                </span>
                <span className="flex items-center gap-1">
                  <ArrowRightLeft className="h-3 w-3" />
                  {region.rules.direction === "both"
                    ? "双向"
                    : region.rules.direction === "in"
                    ? "进入"
                    : "离开"}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {region.rules.schedule.start}-{region.rules.schedule.end}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[#2A3040] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[#E2E8F0]">
            告警记录
          </h3>
          <div className="max-h-60 overflow-y-auto">
            <AlertList />
          </div>
        </div>
      </div>
    </div>
  );
}
