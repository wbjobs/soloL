import { useRef, useState, useCallback, useEffect } from "react";
import { useStore } from "@/store/useStore";
import type { DetectionReport, Detection, DefenseRegion } from "@/types";

interface DetectionReporterResult {
  reportDetection: (detections: Detection[], sourceId: string) => void;
  latestReport: DetectionReport | null;
}

function pointInPolygon(
  px: number,
  py: number,
  polygon: Array<{ x: number; y: number }>
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function useDetectionReporter(): DetectionReporterResult {
  const [latestReport, setLatestReport] = useState<DetectionReport | null>(null);
  const bufferRef = useRef<Detection[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentSourceIdRef = useRef<string | null>(null);
  const regions = useStore((s) => s.regions);
  const reportDetectionAPI = useStore((s) => s.reportDetection);

  const reportDetection = useCallback(
    (detections: Detection[], sourceId: string) => {
      currentSourceIdRef.current = sourceId;
      bufferRef.current.push(...detections);
    },
    []
  );

  useEffect(() => {
    timerRef.current = setInterval(() => {
      const sourceId = currentSourceIdRef.current;
      const detections = bufferRef.current;
      if (!sourceId || detections.length === 0) return;

      const personDetections = detections.filter((d) => d.label === "person");
      const count = personDetections.length;

      const regionResults = regions.map((region: DefenseRegion) => {
        let insideCount = 0;
        for (const det of personDetections) {
          const cx = det.bbox[0] + det.bbox[2] / 2;
          const cy = det.bbox[1] + det.bbox[3] / 2;
          if (pointInPolygon(cx, cy, region.polygon)) {
            insideCount++;
          }
        }
        return {
          regionId: region.id,
          insideCount,
          breached: region.enabled && insideCount > region.rules.maxPeople,
        };
      });

      const report: DetectionReport = {
        sourceId,
        timestamp: new Date().toISOString(),
        detections: personDetections,
        count,
        regions: regionResults,
      };

      setLatestReport(report);
      reportDetectionAPI(report);
      bufferRef.current = [];
    }, 5000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [regions, reportDetectionAPI]);

  return { reportDetection, latestReport };
}
