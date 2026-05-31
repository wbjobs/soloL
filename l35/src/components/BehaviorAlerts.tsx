import { useState } from "react";
import { AlertTriangle, X, Clock } from "lucide-react";
import type { BehaviorAnomalyEvent, ActionType } from "@/types";

interface BehaviorAlertsProps {
  anomalies: BehaviorAnomalyEvent[];
  onDismiss: (id: string) => void;
  onJumpTo: (timestamp: Date) => void;
}

const ACTION_COLORS: Record<ActionType, string> = {
  normal: "#64748B",
  fall: "#EF4444",
  chasing: "#F59E0B",
  running: "#EAB308",
  loitering: "#3B82F6",
};

export default function BehaviorAlerts({
  anomalies,
  onDismiss,
  onJumpTo,
}: BehaviorAlertsProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const unreadCount = anomalies.length;

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div
      style={{
        background: "rgba(10, 14, 23, 0.95)",
        backdropFilter: "blur(8px)",
        border: "1px solid #1E293B",
        borderRadius: 8,
        overflow: "hidden",
        width: 320,
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #1E293B",
          cursor: "pointer",
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={18} style={{ color: "#F59E0B" }} />
          <span style={{ color: "#F1F5F9", fontWeight: 600, fontSize: 14 }}>
            Behavior Alerts
          </span>
        </div>
        {unreadCount > 0 && (
          <div
            style={{
              padding: "2px 8px",
              background: "#EF4444",
              borderRadius: 10,
              fontSize: 11,
              fontWeight: 700,
              color: "#FFF",
            }}
          >
            {unreadCount}
          </div>
        )}
      </div>

      {isExpanded && (
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {anomalies.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "#64748B",
                fontSize: 13,
              }}
            >
              No anomalies detected
            </div>
          ) : (
            anomalies.map((anomaly) => (
              <div
                key={anomaly.id}
                style={{
                  padding: 12,
                  borderBottom: "1px solid #1E293B",
                  cursor: "pointer",
                }}
                onClick={() => onJumpTo(anomaly.timestamp)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(30, 41, 59, 0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          padding: "2px 8px",
                          background: ACTION_COLORS[anomaly.action],
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#0A0E17",
                          textTransform: "uppercase",
                        }}
                      >
                        {anomaly.action}
                      </span>
                      <span
                        style={{
                          color: "#94A3B8",
                          fontSize: 11,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {(anomaly.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        color: "#64748B",
                        fontSize: 11,
                      }}
                    >
                      <Clock size={12} />
                      <span>{formatTime(anomaly.timestamp)}</span>
                      <span>•</span>
                      <span>{formatDate(anomaly.timestamp)}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss(anomaly.id);
                    }}
                    style={{
                      padding: 4,
                      background: "transparent",
                      border: "none",
                      color: "#64748B",
                      cursor: "pointer",
                      borderRadius: 4,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "#EF4444";
                      e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "#64748B";
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
