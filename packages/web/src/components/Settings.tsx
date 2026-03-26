import { useEffect, useState } from "react";
import { trpc } from "../trpc";
import { ModalOverlay } from "./ModalOverlay";

const FONTS = [
  { key: "DotGothic16", label: "DotGothic16", import: "DotGothic16" },
  { key: "Noto Sans JP", label: "Noto Sans JP", import: "Noto+Sans+JP:wght@400;700" },
  { key: "M PLUS 1 Code", label: "M PLUS 1 Code", import: "M+PLUS+1+Code" },
  { key: "Zen Maru Gothic", label: "Zen Maru Gothic", import: "Zen+Maru+Gothic" },
  { key: "Kiwi Maru", label: "Kiwi Maru", import: "Kiwi+Maru" },
  { key: "Kosugi Maru", label: "Kosugi Maru", import: "Kosugi+Maru" },
  { key: "monospace", label: "monospace (system)", import: null },
];

const STORAGE_KEY = "theledger-font";
const THEME_STORAGE_KEY = "theledger-theme";

function getStoredFont(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "DotGothic16";
}

function getStoredTheme(): "dark" | "light" {
  return (localStorage.getItem(THEME_STORAGE_KEY) as "dark" | "light") ?? "dark";
}

export function applyTheme(theme?: "dark" | "light"): void {
  const t = theme ?? getStoredTheme();
  if (t === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function applyFont(fontKey?: string): void {
  const key = fontKey ?? getStoredFont();
  const font = FONTS.find((f) => f.key === key);
  if (!font) return;

  if (font.import) {
    const id = `font-${font.key.replace(/\s+/g, "-")}`;
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${font.import}&display=swap`;
      document.head.appendChild(link);
    }
  }

  document.documentElement.style.setProperty("--font", `"${font.key}", monospace`);
}

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

type Frequency = "daily" | "weekly" | "monthly";

function formatFrequency(
  freq: string,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null,
  hour?: number | null,
): string {
  const h = hour ?? 8;
  const timeStr = `${h}:00`;
  switch (freq) {
    case "daily":
      return `毎日 ${timeStr}`;
    case "weekly":
      return `毎週${DAY_NAMES[dayOfWeek ?? 0]}曜 ${timeStr}`;
    case "monthly":
      return `毎月${dayOfMonth ?? 1}日 ${timeStr}`;
    default:
      return freq;
  }
}

function ScheduleSection() {
  const utils = trpc.useUtils();
  const { data: tasks, isLoading } = trpc.listScheduledTasks.useQuery();
  const createTask = trpc.createScheduledTask.useMutation({
    onSuccess: () => utils.listScheduledTasks.invalidate(),
  });
  const updateTask = trpc.updateScheduledTask.useMutation({
    onSuccess: () => utils.listScheduledTasks.invalidate(),
  });
  const deleteTask = trpc.deleteScheduledTask.useMutation({
    onSuccess: () => utils.listScheduledTasks.invalidate(),
  });

  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState("");
  const [freq, setFreq] = useState<Frequency>("daily");
  const [dayOfWeek, setDayOfWeek] = useState(1); // 月曜
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(8);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleAdd = () => {
    if (!text.trim()) return;
    createTask.mutate({
      raw_text: text.trim(),
      frequency: freq,
      day_of_week: freq === "weekly" ? dayOfWeek : null,
      day_of_month: freq === "monthly" ? dayOfMonth : null,
      hour,
    });
    setText("");
    setShowForm(false);
  };

  return (
    <div className="schedule-section">
      <div className="schedule-section-title">スケジュールおつかい</div>

      {isLoading ? (
        <div className="schedule-empty">読み込み中...</div>
      ) : tasks && tasks.length > 0 ? (
        <div className="schedule-list">
          {tasks.map((task) => (
            <div key={task.id} className="schedule-item">
              <span className="schedule-item-text">{task.raw_text}</span>
              <span className="schedule-item-freq">
                {formatFrequency(task.frequency, task.day_of_week, task.day_of_month, task.hour)}
              </span>
              <button
                type="button"
                className={`schedule-toggle ${task.enabled ? "on" : ""}`}
                onClick={() => updateTask.mutate({ id: task.id, enabled: !task.enabled })}
              >
                {task.enabled ? "ON" : "OFF"}
              </button>
              {confirmDeleteId === task.id ? (
                <>
                  <button
                    type="button"
                    className="schedule-delete"
                    style={{ color: "var(--danger)" }}
                    onClick={() => {
                      deleteTask.mutate({ id: task.id });
                      setConfirmDeleteId(null);
                    }}
                    title="削除する"
                  >
                    {"\u2713"}
                  </button>
                  <button
                    type="button"
                    className="schedule-delete"
                    onClick={() => setConfirmDeleteId(null)}
                    title="やめる"
                  >
                    {"\u2715"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="schedule-delete"
                  onClick={() => setConfirmDeleteId(task.id)}
                >
                  x
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="schedule-empty">スケジュールはまだありません</div>
      )}

      {!showForm ? (
        <button type="button" className="schedule-add-btn" onClick={() => setShowForm(true)}>
          + 追加
        </button>
      ) : (
        <div className="schedule-form">
          <input
            type="text"
            className="schedule-input"
            placeholder="おつかい内容"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="schedule-freq-row">
            {(["daily", "weekly", "monthly"] as const).map((f) => (
              <button
                type="button"
                key={f}
                className={`schedule-freq-btn ${freq === f ? "active" : ""}`}
                onClick={() => setFreq(f)}
              >
                {f === "daily" ? "毎日" : f === "weekly" ? "毎週" : "毎月"}
              </button>
            ))}
          </div>

          {freq === "weekly" && (
            <div className="schedule-day-row">
              {DAY_NAMES.map((name, i) => (
                <button
                  type="button"
                  key={i}
                  className={`schedule-day-btn ${dayOfWeek === i ? "active" : ""}`}
                  onClick={() => setDayOfWeek(i)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {freq === "monthly" && (
            <div className="schedule-option-row">
              <label>日にち:</label>
              <input
                type="number"
                className="schedule-number-input"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Math.min(31, Math.max(1, Number(e.target.value))))}
              />
              <span>日</span>
            </div>
          )}

          <div className="schedule-option-row">
            <label>時刻:</label>
            <select
              className="schedule-select"
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i}:00
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="schedule-submit"
            onClick={handleAdd}
            disabled={createTask.isPending}
          >
            追加
          </button>
        </div>
      )}
    </div>
  );
}

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const [selected, setSelected] = useState(getStoredFont);
  const [theme, setTheme] = useState(getStoredTheme);

  useEffect(() => {
    // プレビュー用に全フォントをプリロード
    for (const font of FONTS) {
      if (font.import) {
        const id = `font-${font.key.replace(/\s+/g, "-")}`;
        if (!document.getElementById(id)) {
          const link = document.createElement("link");
          link.id = id;
          link.rel = "stylesheet";
          link.href = `https://fonts.googleapis.com/css2?family=${font.import}&display=swap`;
          document.head.appendChild(link);
        }
      }
    }
  }, []);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleSelect = (key: string) => {
    setSelected(key);
    localStorage.setItem(STORAGE_KEY, key);
    applyFont(key);
  };

  const handleThemeToggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  };

  return (
    <ModalOverlay ariaLabel="設定" onClose={onClose}>
      <div className="result-modal">
        <div className="result-modal-header">
          <span className="settings-header-title">設定</span>
          <button
            type="button"
            className="result-modal-close"
            aria-label="閉じる"
            onClick={onClose}
          >
            x
          </button>
        </div>
        <div className="result-modal-title">テーマ</div>
        <div className="settings-theme-toggle">
          <button
            type="button"
            className={`settings-theme-btn ${theme === "dark" ? "active" : ""}`}
            onClick={() => {
              if (theme !== "dark") handleThemeToggle();
            }}
          >
            Dark
          </button>
          <button
            type="button"
            className={`settings-theme-btn ${theme === "light" ? "active" : ""}`}
            onClick={() => {
              if (theme !== "light") handleThemeToggle();
            }}
          >
            Light
          </button>
        </div>

        <div className="result-modal-title">フォント</div>
        <div className="settings-font-list">
          {FONTS.map((font) => (
            <button
              type="button"
              key={font.key}
              className={`settings-font-item ${selected === font.key ? "active" : ""}`}
              style={{ fontFamily: `"${font.key}", monospace` }}
              onClick={() => handleSelect(font.key)}
            >
              {font.label}
              <span className="settings-font-preview">あいうえお ABC 123</span>
            </button>
          ))}
        </div>

        <ScheduleSection />
      </div>
    </ModalOverlay>
  );
}
