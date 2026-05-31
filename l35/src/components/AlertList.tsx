import { useStore } from "@/store/useStore";
import { Bell, AlertTriangle, Users } from "lucide-react";
import type { Alert } from "@/types";

export default function AlertList() {
  const alerts = useStore((s) => s.alerts);
  const fetchAlerts = useStore((s) => s.fetchAlerts);

  const markAsRead = async (alert: Alert) => {
    if (alert.read) return;
    try {
      await fetch(`/api/alerts/${alert.id}/read`, { method: "PUT" });
      fetchAlerts(alert.sourceId);
    } catch {}
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const typeConfig = {
    breach: { icon: AlertTriangle, label: "越界", color: "text-[#FF3D71]" },
    overcrowd: { icon: Users, label: "拥挤", color: "text-[#FF3D71]" },
  };

  return (
    <div className="space-y-2">
      {alerts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-[#64748B]">
          <Bell className="mb-2 h-8 w-8" />
          <span className="text-sm">暂无告警</span>
        </div>
      )}
      {alerts.map((alert) => {
        const cfg = typeConfig[alert.type];
        const Icon = cfg.icon;
        return (
          <div
            key={alert.id}
            onClick={() => markAsRead(alert)}
            className={`cursor-pointer rounded-lg border-l-4 bg-[#1A1F2E] p-3 transition-colors hover:bg-[#2A3040] ${
              alert.read
                ? "border-l-[#2A3040] opacity-60"
                : "border-l-[#FF3D71]"
            }`}
          >
            <div className="flex items-start gap-3">
              {alert.snapshot && (
                <img
                  src={
                    alert.snapshot.startsWith("data:")
                      ? alert.snapshot
                      : `data:image/jpeg;base64,${alert.snapshot}`
                  }
                  alt="snapshot"
                  className="h-12 w-16 rounded object-cover"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                  <span className={`text-xs font-medium ${cfg.color}`}>
                    {cfg.label}
                  </span>
                  <span className="ml-auto text-[10px] text-[#64748B]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    {formatTime(alert.timestamp)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#E2E8F0] truncate">
                  {alert.details}
                </p>
              </div>
            </div>
            {!alert.read && (
              <span className="mt-1 inline-block rounded bg-[#FF3D71]/20 px-1.5 py-0.5 text-[10px] text-[#FF3D71]">
                未读
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
