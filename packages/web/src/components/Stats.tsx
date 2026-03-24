import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "../trpc";

interface StatsProps {
  onClose: () => void;
}

export function Stats({ onClose }: StatsProps) {
  const stats = trpc.getStats.useQuery();

  if (stats.isLoading) {
    return (
      <div className="stats-fullscreen">
        <button type="button" className="stats-close" onClick={onClose}>
          x
        </button>
        <div className="stats-content">
          <div className="stats-streak">...</div>
        </div>
      </div>
    );
  }

  if (stats.error || !stats.data) {
    return (
      <div className="stats-fullscreen">
        <button type="button" className="stats-close" onClick={onClose}>
          x
        </button>
        <div className="stats-content">
          <div className="stats-streak">データ取得に失敗しました</div>
        </div>
      </div>
    );
  }

  const { streak, weeklyCompletions, leadTimeDistribution, hourlyCompletions } =
    stats.data;

  const tooltipStyle = {
    contentStyle: {
      background: "#000",
      border: "1px solid #444",
      borderRadius: 4,
      color: "#fff",
      fontSize: 12,
    },
    itemStyle: { color: "#fff" },
    labelStyle: { color: "#aaa" },
  };

  return (
    <div className="stats-fullscreen">
      <button type="button" className="stats-close" onClick={onClose}>
        x
      </button>
      <div className="stats-content">
        <div className="stats-streak">
          {streak > 0 ? (
            <>
              <span className="stats-streak-number">{streak}</span>
              日連続
            </>
          ) : (
            "今日はまだ"
          )}
        </div>

        <div className="stats-section">
          <div className="stats-section-title">週間完了数</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weeklyCompletions}>
              <CartesianGrid stroke="#222" strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fill: "#aaa", fontSize: 12 }} />
              <YAxis tick={{ fill: "#aaa", fontSize: 12 }} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" fill="#ff0" name="完了数" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-section">
          <div className="stats-section-title">リードタイム</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={leadTimeDistribution}>
              <CartesianGrid stroke="#222" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tick={{ fill: "#aaa", fontSize: 12 }} />
              <YAxis tick={{ fill: "#aaa", fontSize: 12 }} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" fill="#0f0" name="件数" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="stats-section">
          <div className="stats-section-title">完了した時間帯</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourlyCompletions}>
              <CartesianGrid stroke="#222" strokeDasharray="3 3" />
              <XAxis
                dataKey="hour"
                tick={{ fill: "#aaa", fontSize: 12 }}
                tickFormatter={(h: number) => `${h}`}
              />
              <YAxis tick={{ fill: "#aaa", fontSize: 12 }} allowDecimals={false} />
              <Tooltip
                {...tooltipStyle}
                labelFormatter={(h: number) => `${h}時`}
              />
              <Bar dataKey="count" fill="#ff0" name="完了数" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
