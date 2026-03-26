import { useEffect, useMemo, useState } from "react";
import { POLL } from "../poll";
import { trpc } from "../trpc";

interface FocusModeProps {
  onClose: () => void;
}

export function FocusMode({ onClose }: FocusModeProps) {
  const [completedToday, setCompletedToday] = useState(0);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());

  const entries = trpc.listEntries.useQuery(
    { type: "task" as const },
    { refetchInterval: POLL.entries },
  );
  const utils = trpc.useUtils();
  const updateEntry = trpc.updateEntry.useMutation({
    onSuccess: () => {
      utils.listEntries.invalidate();
    },
  });

  // Pick the next task: urgent > due_date nearest > oldest incomplete
  const currentTask = useMemo(() => {
    const tasks = (entries.data ?? []).filter(
      (e) => e.status !== "done" && e.type !== "trash" && !e.delegatable && !skippedIds.has(e.id),
    );
    if (tasks.length === 0) return null;

    // Sort: urgent first, then nearest due_date, then oldest created_at
    const sorted = [...tasks].sort((a, b) => {
      // Urgent tasks first
      if (a.urgent && !b.urgent) return -1;
      if (!a.urgent && b.urgent) return 1;

      // Due date: nearest first (null = no deadline = last)
      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;

      // Oldest first
      return new Date(`${a.created_at}Z`).getTime() - new Date(`${b.created_at}Z`).getTime();
    });

    return sorted[0];
  }, [entries.data, skippedIds]);

  const handleComplete = () => {
    if (!currentTask) return;
    updateEntry.mutate({ id: currentTask.id, status: "done" });
    setCompletedToday((c) => c + 1);
    // Remove from skipped if it was there
    setSkippedIds((prev) => {
      const next = new Set(prev);
      next.delete(currentTask.id);
      return next;
    });
  };

  const handleSkip = () => {
    if (!currentTask) return;
    setSkippedIds((prev) => new Set(prev).add(currentTask.id));
  };

  // Keyboard shortcuts: Enter → complete, ArrowRight → skip
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleComplete();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const remainingCount = (entries.data ?? []).filter(
    (e) => e.status !== "done" && e.type !== "trash" && !e.delegatable,
  ).length;

  return (
    <div className="focus-mode">
      <div className="focus-mode-header">
        <button type="button" className="focus-mode-close" onClick={onClose}>
          {"\u2715"}
        </button>
      </div>

      <div className="focus-mode-counter">
        {completedToday > 0 && (
          <span className="focus-mode-today">
            {"\u2714"} {completedToday}
          </span>
        )}
      </div>

      <div className="focus-mode-center">
        {currentTask ? (
          <>
            <div className="focus-mode-card">
              {currentTask.urgent && <span className="focus-mode-urgent">URGENT</span>}
              {currentTask.due_date &&
                (() => {
                  const now = new Date();
                  now.setHours(0, 0, 0, 0);
                  const due = new Date(`${currentTask.due_date}T00:00:00`);
                  const diff = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                  const dateStr = due.toLocaleDateString("ja-JP", {
                    month: "short",
                    day: "numeric",
                  });
                  const remain =
                    diff < 0
                      ? `${-diff}日超過`
                      : diff === 0
                        ? "今日"
                        : diff === 1
                          ? "明日"
                          : `あと${diff}日`;
                  const cls = diff < 0 ? "overdue" : diff <= 3 ? "soon" : "";
                  return (
                    <span className={`focus-mode-due ${cls}`}>
                      {dateStr}（{remain}）
                    </span>
                  );
                })()}
              <h1 className="focus-mode-title">{currentTask.title || currentTask.raw_text}</h1>
              {currentTask.title && currentTask.raw_text !== currentTask.title && (
                <p className="focus-mode-detail">{currentTask.raw_text}</p>
              )}
              {currentTask.tags && currentTask.tags.length > 0 && (
                <div className="focus-mode-tags">
                  {currentTask.tags.map((t) => (
                    <span key={t} className="focus-mode-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="focus-mode-actions">
              <button
                type="button"
                className="focus-mode-btn focus-mode-btn-done"
                onClick={handleComplete}
                disabled={updateEntry.isPending}
              >
                {"\u2714"} 完了
              </button>
              <button
                type="button"
                className="focus-mode-btn focus-mode-btn-skip"
                onClick={handleSkip}
              >
                スキップ {"\u2192"}
              </button>
            </div>
          </>
        ) : (
          <div className="focus-mode-empty">
            {completedToday > 0
              ? `${completedToday}個完了! おつかれさまでした`
              : "タスクがありません"}
          </div>
        )}
      </div>

      <div className="focus-mode-footer">
        <span className="focus-mode-remaining">残り {remainingCount} 件</span>
      </div>
    </div>
  );
}
