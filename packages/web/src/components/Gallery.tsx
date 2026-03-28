import { lazy, Suspense, useCallback, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { trpc } from "../trpc";

const GraphView = lazy(() => import("./GraphView").then((m) => ({ default: m.GraphView })));

type GalleryTab = "graph" | "stats";

interface GalleryProps {
  onClose: () => void;
}

const tooltipStyle = {
  contentStyle: {
    background: "var(--surface, #111)",
    border: "1px solid var(--border-muted, #333)",
    borderRadius: 4,
    color: "var(--fg, #fff)",
    fontSize: 11,
    fontFamily: "var(--font)",
    padding: "6px 10px",
  },
  itemStyle: { color: "var(--fg, #fff)" },
  labelStyle: { color: "var(--dim, #888)" },
  cursor: { fill: "rgba(255,255,255,0.03)" },
};

function StatsView() {
  const stats = trpc.getStats.useQuery();

  if (stats.isLoading) {
    return <div className="gallery-loading">...</div>;
  }

  if (stats.error || !stats.data) {
    return <div className="gallery-loading">データ取得に失敗しました</div>;
  }

  const { streak, weeklyCompletions, leadTimeDistribution, hourlyCompletions } = stats.data;

  const totalCompleted = weeklyCompletions.reduce((s, w) => s + w.count, 0);
  const avgLeadTime = (() => {
    const weights = [0, 1, 2.5, 5.5, 10];
    let total = 0;
    let count = 0;
    leadTimeDistribution.forEach((b, i) => {
      total += weights[i] * b.count;
      count += b.count;
    });
    return count > 0 ? (total / count).toFixed(1) : "-";
  })();
  const peakHour =
    hourlyCompletions.length > 0
      ? hourlyCompletions.reduce((max, h) => (h.count > max.count ? h : max), hourlyCompletions[0])
      : null;

  return (
    <div className="dash">
      {/* KPI row */}
      <div className="dash-kpi-row">
        <div className="dash-card dash-card-accent">
          <div className="dash-kpi-value">{streak}</div>
          <div className="dash-kpi-label">日連続</div>
        </div>
        <div className="dash-card">
          <div className="dash-kpi-value">{totalCompleted}</div>
          <div className="dash-kpi-label">今月完了</div>
        </div>
        <div className="dash-card">
          <div className="dash-kpi-value">{avgLeadTime}</div>
          <div className="dash-kpi-label">平均日数</div>
        </div>
        <div className="dash-card">
          <div className="dash-kpi-value">
            {peakHour && peakHour.count > 0 ? `${peakHour.hour}時` : "-"}
          </div>
          <div className="dash-kpi-label">ピーク</div>
        </div>
      </div>

      {/* Charts */}
      <div className="dash-grid">
        <div className="dash-card dash-chart-card">
          <div className="dash-chart-title">週間完了数</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weeklyCompletions} barCategoryGap="20%">
              <CartesianGrid stroke="#1a1a1a" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fill: "#555", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#555", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={24}
              />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" fill="#ff0" name="完了数" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="dash-card dash-chart-card">
          <div className="dash-chart-title">リードタイム</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={leadTimeDistribution} barCategoryGap="20%">
              <CartesianGrid stroke="#1a1a1a" vertical={false} />
              <XAxis
                dataKey="bucket"
                tick={{ fill: "#555", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#555", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={24}
              />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" name="件数" radius={[3, 3, 0, 0]}>
                {leadTimeDistribution.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? "#0f0" : i <= 2 ? "#0a0" : "#050"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="dash-card dash-chart-card dash-chart-wide">
        <div className="dash-chart-title">完了した時間帯</div>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={hourlyCompletions} barCategoryGap="10%">
            <CartesianGrid stroke="#1a1a1a" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fill: "#555", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(h: number) => (h % 3 === 0 ? `${h}` : "")}
            />
            <YAxis hide allowDecimals={false} />
            <Tooltip {...tooltipStyle} labelFormatter={(h: number) => `${h}時`} />
            <Bar dataKey="count" name="完了数" radius={[2, 2, 0, 0]}>
              {hourlyCompletions.map((entry, i) => (
                <Cell
                  key={i}
                  fill={
                    peakHour && entry.hour === peakHour.hour && entry.count > 0 ? "#ff0" : "#333"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function Gallery({ onClose }: GalleryProps) {
  const [tab, setTab] = useState<GalleryTab>("graph");
  useEscapeKey(useCallback(() => onClose(), [onClose]));

  return (
    <div className="gallery">
      <div className="gallery-header">
        <div className="gallery-tabs">
          <button
            type="button"
            className={`gallery-tab ${tab === "graph" ? "active" : ""}`}
            onClick={() => setTab("graph")}
          >
            グラフ
          </button>
          <button
            type="button"
            className={`gallery-tab ${tab === "stats" ? "active" : ""}`}
            onClick={() => setTab("stats")}
          >
            統計
          </button>
        </div>
        <button type="button" className="gallery-close" aria-label="閉じる" onClick={onClose}>
          x
        </button>
      </div>
      <div className="gallery-body">
        {tab === "graph" ? (
          <Suspense fallback={<div className="gallery-loading">...</div>}>
            <GraphView fullscreen />
          </Suspense>
        ) : (
          <StatsView />
        )}
      </div>
    </div>
  );
}
