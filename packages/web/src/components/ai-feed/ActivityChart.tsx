import { useMemo } from "react";
import type { EntryItem } from "./types";

interface ActivityChartProps {
  completed: EntryItem[];
}

/** 5-minute bin activity bar chart for the past 24 hours */
export function ActivityChart({ completed }: ActivityChartProps) {
  const bins = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Count completions per 5-minute bin (keyed by absolute minutes since cutoff)
    const counts = new Map<number, number>();

    for (const entry of completed) {
      if (!entry.completed_at) continue;
      const dt = new Date(`${entry.completed_at}Z`);
      if (dt < cutoff || dt > now) continue;

      const diffMs = dt.getTime() - cutoff.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const bin = Math.floor(diffMinutes / 5) * 5;
      counts.set(bin, (counts.get(bin) ?? 0) + 1);
    }

    if (counts.size === 0) return [];

    // Build full 24-hour range: 0 to 1435 (288 bins of 5 minutes)
    const totalMinutes = 24 * 60;
    const result: { minute: number; count: number; label: string }[] = [];
    for (let m = 0; m < totalMinutes; m += 5) {
      // Compute the wall-clock time for this bin
      const binTime = new Date(cutoff.getTime() + m * 60 * 1000);
      const h = binTime.getHours();
      const mm = binTime.getMinutes();
      result.push({
        minute: m,
        count: counts.get(m) ?? 0,
        label: `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
      });
    }
    return result;
  }, [completed]);

  if (bins.length === 0) return null;

  const maxCount = Math.max(...bins.map((b) => b.count));
  // Show a label every ~6 bars or fewer
  const labelInterval = Math.max(1, Math.ceil(bins.length / 8));

  return (
    <div className="activity-chart">
      <div className="activity-chart-title">完了推移 (過去24時間・5分間隔)</div>
      <div className="activity-chart-body">
        <div className="activity-chart-bars">
          {bins.map((bin, i) => (
            <div key={bin.minute} className="activity-chart-col">
              <div
                className={`activity-chart-bar ${bin.count > 0 ? "filled" : ""}`}
                style={{ height: `${maxCount > 0 ? (bin.count / maxCount) * 100 : 0}%` }}
                title={`${bin.label}: ${bin.count}件`}
              />
              {i % labelInterval === 0 && <span className="activity-chart-label">{bin.label}</span>}
            </div>
          ))}
        </div>
        <div className="activity-chart-yaxis">
          <span>{maxCount}</span>
          <span>{Math.ceil(maxCount / 2)}</span>
          <span>0</span>
        </div>
      </div>
    </div>
  );
}
