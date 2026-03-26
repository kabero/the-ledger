import { useMemo } from "react";
import type { EntryItem } from "./types";

interface ActivityChartProps {
  completed: EntryItem[];
}

/** 5-minute bin activity bar chart for today's completed tasks */
export function ActivityChart({ completed }: ActivityChartProps) {
  const bins = useMemo(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Count completions per 5-minute bin
    const counts = new Map<number, number>();
    let minBin = Number.POSITIVE_INFINITY;
    let maxBin = Number.NEGATIVE_INFINITY;

    for (const entry of completed) {
      if (!entry.completed_at) continue;
      const dt = new Date(`${entry.completed_at}Z`);
      // Filter to today only
      const entryDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      if (entryDate !== todayStr) continue;

      const minuteOfDay = dt.getHours() * 60 + dt.getMinutes();
      const bin = Math.floor(minuteOfDay / 5) * 5;
      counts.set(bin, (counts.get(bin) ?? 0) + 1);
      if (bin < minBin) minBin = bin;
      if (bin > maxBin) maxBin = bin;
    }

    if (counts.size === 0) return [];

    // Build array from minBin to maxBin filling gaps with 0
    const result: { minute: number; count: number; label: string }[] = [];
    for (let m = minBin; m <= maxBin; m += 5) {
      const h = Math.floor(m / 60);
      const mm = m % 60;
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
      <div className="activity-chart-title">今日の完了推移 (5分間隔)</div>
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
