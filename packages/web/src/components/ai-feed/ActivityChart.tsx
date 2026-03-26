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

  // Daily completion counts for the past 14 days
  const dailyBins = useMemo(() => {
    const now = new Date();
    const counts = new Map<string, number>();

    for (const entry of completed) {
      if (!entry.completed_at) continue;
      const dt = new Date(`${entry.completed_at}Z`);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // Build past 14 days (including today)
    const result: { date: string; count: number; label: string }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      result.push({ date: key, count: counts.get(key) ?? 0, label });
    }

    // Only show if there is at least one day with data
    const hasData = result.some((b) => b.count > 0);
    if (!hasData) return [];

    // Trim leading zeros to show 7-14 days of relevant data
    let startIdx = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i].count > 0) {
        // Show at least 1 day before the first non-zero, capped at 7 days before end
        startIdx = Math.max(0, Math.min(i - 1, result.length - 7));
        break;
      }
    }
    return result.slice(startIdx);
  }, [completed]);

  const hasTodayChart = bins.length > 0;
  const hasDailyChart = dailyBins.length > 0;

  if (!hasTodayChart && !hasDailyChart) return null;

  const maxCount = hasTodayChart ? Math.max(...bins.map((b) => b.count)) : 0;
  // Show a label every ~6 bars or fewer
  const labelInterval = hasTodayChart ? Math.max(1, Math.ceil(bins.length / 8)) : 1;

  const dailyMax = hasDailyChart ? Math.max(...dailyBins.map((b) => b.count)) : 0;

  return (
    <div className="activity-chart">
      {hasTodayChart && (
        <>
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
                  {i % labelInterval === 0 && (
                    <span className="activity-chart-label">{bin.label}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="activity-chart-yaxis">
              <span>{maxCount}</span>
              <span>{Math.ceil(maxCount / 2)}</span>
              <span>0</span>
            </div>
          </div>
        </>
      )}
      {hasDailyChart && (
        <>
          <div className="activity-chart-title daily-chart-title">
            日別完了数 (過去{dailyBins.length}日)
          </div>
          <div className="activity-chart-body daily-chart-body">
            <div className="activity-chart-bars daily-chart-bars">
              {dailyBins.map((bin) => (
                <div key={bin.date} className="activity-chart-col daily-chart-col">
                  <div
                    className={`activity-chart-bar daily-chart-bar ${bin.count > 0 ? "filled" : ""}`}
                    style={{ height: `${dailyMax > 0 ? (bin.count / dailyMax) * 100 : 0}%` }}
                    title={`${bin.label}: ${bin.count}件`}
                  />
                  {bin.count > 0 && <span className="daily-chart-count">{bin.count}</span>}
                  <span className="activity-chart-label">{bin.label}</span>
                </div>
              ))}
            </div>
            <div className="activity-chart-yaxis">
              <span>{dailyMax}</span>
              <span>{Math.ceil(dailyMax / 2)}</span>
              <span>0</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
