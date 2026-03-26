import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POLL } from "../poll";
import { trpc } from "../trpc";
import type { Tab } from "../types";
import { ConfirmModal } from "./ConfirmModal";
import { ResultModal } from "./ResultModal";

type EntryRow = ReturnType<typeof trpc.listEntries.useQuery>["data"] extends (infer T)[] | undefined
  ? T & { status: string | null; completed_at: string | null }
  : never;

interface EntryListProps {
  tab: Tab;
}

export function EntryList({ tab }: EntryListProps) {
  const filter =
    tab === "all"
      ? { processed: true }
      : tab === "done"
        ? { status: "done" as const, sort: "completed_at" as const }
        : tab === "unprocessed"
          ? { processed: false }
          : tab === "llm"
            ? { delegatable: true }
            : { type: tab as "task" | "note" | "wish" };

  const entries = trpc.listEntries.useQuery(filter, { refetchInterval: POLL.entries });
  const utils = trpc.useUtils();

  // Stable ref for tab so renderEntry doesn't re-create on tab switch
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // ローカルのステータス上書き（チェック直後の見た目用、次回refetchでクリア）
  const [localStatus, setLocalStatus] = useState<
    Record<string, { status: string; completed_at: string | null }>
  >({});

  const updateEntry = trpc.updateEntry.useMutation({
    onError: () => {
      // Rollback optimistic local status on error
      setLocalStatus({});
      utils.listEntries.invalidate();
    },
  });

  const deleteEntry = trpc.deleteEntry.useMutation({
    onSuccess: () => {
      utils.listEntries.invalidate();
    },
    onError: () => {
      utils.listEntries.invalidate();
    },
  });

  // Stable refs for mutations to avoid re-creating renderEntry on every render
  const updateRef = useRef(updateEntry.mutate);
  updateRef.current = updateEntry.mutate;
  const deleteRef = useRef(deleteEntry.mutate);
  deleteRef.current = deleteEntry.mutate;

  const [modalEntry, setModalEntry] = useState<{ title: string; result: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    message: string;
    onOk: () => void;
    okLabel?: string;
  } | null>(null);

  // Undo toast state
  const [undoToast, setUndoToast] = useState<{
    message: string;
    timerId: ReturnType<typeof setTimeout>;
    undoFn: () => void;
  } | null>(null);

  // Ref to hold the pending execute function so we can cancel it on refetch
  const pendingExecuteRef = useRef<(() => void) | null>(null);

  const dismissUndo = useCallback(() => {
    setUndoToast((prev) => {
      if (prev) clearTimeout(prev.timerId);
      return null;
    });
    pendingExecuteRef.current = null;
  }, []);

  const showUndoToast = useCallback(
    (message: string, executeFn: () => void, undoFn: () => void) => {
      // Dismiss any existing toast first
      setUndoToast((prev) => {
        if (prev) {
          clearTimeout(prev.timerId);
        }
        return null;
      });
      pendingExecuteRef.current = executeFn;
      const timerId = setTimeout(() => {
        // Only execute if the pending function hasn't been cancelled by a refetch
        if (pendingExecuteRef.current === executeFn) {
          executeFn();
          pendingExecuteRef.current = null;
        }
        setUndoToast(null);
      }, 5000);
      setUndoToast({ message, timerId, undoFn });
    },
    [],
  );

  // refetch時にローカル上書きをクリア & 未実行のundo mutationをキャンセル
  const prevDataRef = useRef(entries.data);
  if (entries.data !== prevDataRef.current) {
    prevDataRef.current = entries.data;
    if (Object.keys(localStatus).length > 0) {
      // Server data has refreshed — if there's a pending deferred mutation,
      // fire it now so we don't lose the user's intent.
      if (pendingExecuteRef.current) {
        pendingExecuteRef.current();
        pendingExecuteRef.current = null;
      }
      setLocalStatus({});
      dismissUndo();
    }
  }

  useEffect(() => {
    document.body.style.overflow = modalEntry || confirmAction ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [modalEntry, confirmAction]);

  const DAY_MS = 24 * 60 * 60 * 1000;

  const items = useMemo(() => {
    const now = Date.now();
    const raw = entries.data ?? [];
    // まずサーバーデータでフィルタ・ソート（位置確定）
    const filtered = raw.filter((e) => {
      if (tab === "unprocessed") return true;
      if (tab === "llm") return e.type !== "trash";
      if (e.type === "trash") return false;
      if (tab === "task" && e.delegatable) return false;
      if (tab === "task" && e.status === "done") {
        if (!e.completed_at) return false;
        return now - new Date(`${e.completed_at}Z`).getTime() < DAY_MS;
      }
      if (tab !== "done" && tab !== "task" && e.status === "done") return false;
      return true;
    });
    const sorted =
      tab === "task"
        ? [...filtered].sort((a, b) => {
            // 1. Done items sink to bottom
            const aDone = a.status === "done" ? 1 : 0;
            const bDone = b.status === "done" ? 1 : 0;
            if (aDone !== bDone) return aDone - bDone;
            if (aDone && bDone) {
              return (b.completed_at ?? "").localeCompare(a.completed_at ?? "");
            }
            // 2. Among pending: urgent (priority-flagged) float to top
            const aUrgent = a.urgent ? 1 : 0;
            const bUrgent = b.urgent ? 1 : 0;
            if (aUrgent !== bUrgent) return bUrgent - aUrgent;
            // 3. Among urgent: overdue items first
            if (aUrgent && bUrgent) {
              const now = new Date();
              now.setHours(0, 0, 0, 0);
              const aDue = a.due_date ? new Date(`${a.due_date}T00:00:00`) : null;
              const bDue = b.due_date ? new Date(`${b.due_date}T00:00:00`) : null;
              const aOverdue = aDue && aDue.getTime() < now.getTime() ? 1 : 0;
              const bOverdue = bDue && bDue.getTime() < now.getTime() ? 1 : 0;
              if (aOverdue !== bOverdue) return bOverdue - aOverdue;
            }
            return 0;
          })
        : filtered;
    // 最後にローカル上書きを適用（位置は変えない）
    return sorted.map((e) => {
      const local = localStatus[e.id];
      return local
        ? { ...e, status: local.status as typeof e.status, completed_at: local.completed_at }
        : e;
    });
  }, [entries.data, localStatus, tab]);

  const renderEntry = useCallback(
    (entry: EntryRow) => (
      <div
        key={entry.id}
        className={`entry ${entry.status === "done" ? "done" : ""} ${entry.urgent ? "urgent" : ""} ${entry.result_url ? "has-url" : ""}`}
      >
        {entry.type === "task" && (
          <button
            type="button"
            className="checkbox"
            onClick={() => {
              const newStatus = entry.status === "done" ? "pending" : "done";
              const prevStatus = entry.status;
              const prevCompletedAt = entry.completed_at;
              if (tabRef.current === "llm" && newStatus === "pending") {
                setConfirmAction({
                  message: "おつかいの成果があるけど、未完了に戻しますか？",
                  onOk: () => {
                    setLocalStatus((prev) => ({
                      ...prev,
                      [entry.id]: { status: "pending", completed_at: null },
                    }));
                    updateRef.current({ id: entry.id, status: "pending" });
                    setConfirmAction(null);
                  },
                });
                return;
              }
              // Optimistic update
              const newCompletedAt =
                newStatus === "done"
                  ? new Date().toISOString().replace("T", " ").slice(0, 19)
                  : null;
              setLocalStatus((prev) => ({
                ...prev,
                [entry.id]: {
                  status: newStatus,
                  completed_at: newCompletedAt,
                },
              }));
              // Show undo toast with delayed server call
              const label = entry.title ?? entry.raw_text;
              const msg =
                newStatus === "done"
                  ? `「${label.length > 15 ? `${label.slice(0, 15)}...` : label}」を完了`
                  : `「${label.length > 15 ? `${label.slice(0, 15)}...` : label}」を未完了に戻す`;
              showUndoToast(
                msg,
                () => {
                  updateRef.current({ id: entry.id, status: newStatus });
                },
                () => {
                  // Revert optimistic update
                  setLocalStatus((prev) => ({
                    ...prev,
                    [entry.id]: {
                      status: prevStatus ?? "pending",
                      completed_at: prevCompletedAt ?? null,
                    },
                  }));
                },
              );
            }}
          >
            {entry.status === "done" ? "\u2713" : ""}
          </button>
        )}
        {entry.type === "task" && entry.status !== "done" && (
          <button
            type="button"
            className={`btn-priority ${entry.urgent ? "active" : ""}`}
            onClick={() => updateRef.current({ id: entry.id, urgent: !entry.urgent })}
            title={entry.urgent ? "優先フラグを外す" : "優先フラグを付ける"}
          >
            !
          </button>
        )}
        <div className="entry-title">
          <div>
            {entry.result ? (
              <button
                type="button"
                className="btn-result-title"
                onClick={() => {
                  setModalEntry({
                    title: entry.title ?? entry.raw_text,
                    result: entry.result as string,
                  });
                  if (!entry.result_seen) {
                    updateRef.current({ id: entry.id, result_seen: true });
                  }
                }}
              >
                {!entry.result_seen && <span className="badge-new">NEW</span>}
                {entry.title ?? entry.raw_text}
              </button>
            ) : (
              (entry.title ?? entry.raw_text)
            )}
            {entry.result_url && (
              <button
                type="button"
                className="entry-result-url-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(entry.result_url as string, "_blank", "noopener,noreferrer,popup");
                }}
                title={entry.result_url}
              >
                {"\u2197"} URL
              </button>
            )}
          </div>
          <div className="entry-tags">
            {entry.type && tabRef.current === "all" && (
              <span className={`entry-type-badge entry-type-${entry.type}`}>{entry.type}</span>
            )}
            {entry.due_date &&
              entry.status !== "done" &&
              (() => {
                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const due = new Date(`${entry.due_date}T00:00:00`);
                const diff = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                const cls = diff < 0 ? "overdue" : diff <= 3 ? "soon" : "";
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
                return (
                  <span className={`due-date ${cls}`}>
                    {dateStr}（{remain}）
                  </span>
                );
              })()}
            {entry.completed_at &&
              (tabRef.current === "done" ||
                tabRef.current === "llm" ||
                tabRef.current === "task") && (
                <span className="completed-at">
                  {new Date(`${entry.completed_at}Z`).toLocaleDateString("ja-JP", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
          </div>
        </div>
        <button
          type="button"
          className="btn-del"
          aria-label="削除"
          onClick={() => {
            setConfirmAction({
              message: `「${entry.title ?? entry.raw_text}」を削除しますか？`,
              okLabel: "削除",
              onOk: () => {
                deleteRef.current({ id: entry.id });
                setConfirmAction(null);
              },
            });
          }}
        >
          x
        </button>
      </div>
    ),
    [showUndoToast],
  );

  const pending = useMemo(
    () => (tab === "task" ? items.filter((e) => e.status !== "done") : items),
    [items, tab],
  );
  const done = useMemo(
    () => (tab === "task" ? items.filter((e) => e.status === "done") : []),
    [items, tab],
  );

  if (entries.isLoading) {
    return (
      <div className="skeleton-list">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton-entry">
            <div className="skeleton-line skeleton-line-title" />
            <div className="skeleton-line skeleton-line-sub" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">まだ何もない。</div>
        <div className="empty-state-hint">
          頭の中にあること、なんでも書いてみて。
          <br />
          <span className="empty-state-arrow">{"+"} を押して入力スタート</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {confirmAction && (
        <ConfirmModal
          message={confirmAction.message}
          onOk={confirmAction.onOk}
          onCancel={() => setConfirmAction(null)}
          okLabel={confirmAction.okLabel}
        />
      )}
      {modalEntry && (
        <ResultModal
          title={modalEntry.title}
          result={modalEntry.result}
          onClose={() => setModalEntry(null)}
        />
      )}
      <div>
        {tab === "task" && pending.length === 0 && done.length > 0 && (
          <div className="all-done-state">
            <div className="all-done-title">全部やった！</div>
            <div className="all-done-hint">今日のタスクは全部片付いたよ。おつかれさま。</div>
          </div>
        )}
        {pending.map(renderEntry)}
        {done.length > 0 && <DoneSection items={done} renderEntry={renderEntry} />}
      </div>
      {undoToast && (
        <div className="undo-toast">
          <span className="undo-toast-msg">{undoToast.message}</span>
          <button
            type="button"
            className="undo-toast-btn"
            onClick={() => {
              undoToast.undoFn();
              dismissUndo();
            }}
          >
            元に戻す
          </button>
        </div>
      )}
    </>
  );
}

function DoneSection({
  items,
  renderEntry,
}: {
  items: EntryRow[];
  renderEntry: (entry: EntryRow) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="done-section">
      <button type="button" className="done-section-toggle" onClick={() => setOpen(!open)}>
        {open ? "\u25BC" : "\u25B6"} 完了済み ({items.length})
      </button>
      {open && items.map((entry) => renderEntry(entry))}
    </div>
  );
}
