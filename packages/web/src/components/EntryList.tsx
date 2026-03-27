import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { remarkPlugins, safeUrlTransform } from "../markdown";
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

  const reopenTask = trpc.reopenTask.useMutation({
    onSuccess: () => {
      utils.listEntries.invalidate();
    },
  });
  const reopenRef = useRef(reopenTask.mutate);
  reopenRef.current = reopenTask.mutate;

  // Stable refs for mutations to avoid re-creating renderEntry on every render
  const updateRef = useRef(updateEntry.mutate);
  updateRef.current = updateEntry.mutate;
  const deleteRef = useRef(deleteEntry.mutate);
  deleteRef.current = deleteEntry.mutate;

  // Pagination for llm (おつかい) tab: show PAGE_SIZE items initially
  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Reset visible count when tab changes
  const prevTabRef = useRef(tab);
  if (prevTabRef.current !== tab) {
    prevTabRef.current = tab;
    setVisibleCount(PAGE_SIZE);
  }

  const [modalEntry, setModalEntry] = useState<{ title: string; result: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    message: string;
    onOk: () => void;
    okLabel?: string;
  } | null>(null);

  // Detail panel state
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reset search and selection when tab changes
  const prevTabForResetRef = useRef(tab);
  if (prevTabForResetRef.current !== tab) {
    prevTabForResetRef.current = tab;
    setSearchQuery("");
    setSelectedEntryId(null);
    setSearchExpanded(false);
  }

  // "/" key shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setSearchExpanded(true);
        searchInputRef.current?.focus();
      }
      // Escape to close detail panel
      if (e.key === "Escape" && selectedEntryId) {
        setSelectedEntryId(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedEntryId]);

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
    document.body.style.overflow = modalEntry || confirmAction || selectedEntryId ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [modalEntry, confirmAction, selectedEntryId]);

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

  // Search filtering
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((e) => {
      const title = (e.title ?? "").toLowerCase();
      const rawText = (e.raw_text ?? "").toLowerCase();
      const tags = (e.tags ?? []).join(" ").toLowerCase();
      return title.includes(q) || rawText.includes(q) || tags.includes(q);
    });
  }, [items, searchQuery]);

  // Selected entry data
  const selectedEntry = useMemo(() => {
    if (!selectedEntryId) return null;
    return items.find((e) => e.id === selectedEntryId) ?? null;
  }, [items, selectedEntryId]);

  const renderEntry = useCallback(
    (entry: EntryRow) => (
      // biome-ignore lint/a11y/noStaticElementInteractions: entry card click opens detail panel
      // biome-ignore lint/a11y/useKeyWithClickEvents: entry card click opens detail panel
      <div
        key={entry.id}
        className={`entry entry-card-${entry.type} ${entry.status === "done" ? "done" : ""} ${entry.urgent ? "urgent" : ""} ${entry.type === "wish" ? "wish-entry" : ""} ${entry.result_url ? "has-url" : ""} ${entry.id === selectedEntryId ? "entry-selected" : ""}`}
        onClick={(e) => {
          // Don't open detail if clicking on a button
          if ((e.target as HTMLElement).closest("button")) return;
          setSelectedEntryId(entry.id === selectedEntryId ? null : entry.id);
        }}
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
            ) : tabRef.current === "note" ? (
              <span
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {entry.raw_text}
              </span>
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
            {entry.result_url && (
              <span className="entry-url-badge" title={entry.result_url}>
                🔗
              </span>
            )}
            {entry.type && tabRef.current === "all" && (
              <span className={`entry-type-badge entry-type-${entry.type}`}>{entry.type}</span>
            )}
            {entry.tags &&
              entry.tags.length > 0 &&
              entry.tags.slice(0, 3).map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
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
    [showUndoToast, selectedEntryId],
  );

  const pending = useMemo(
    () => (tab === "task" ? filteredItems.filter((e) => e.status !== "done") : filteredItems),
    [filteredItems, tab],
  );
  const done = useMemo(
    () => (tab === "task" ? filteredItems.filter((e) => e.status === "done") : []),
    [filteredItems, tab],
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
    const emptyMessages: Record<string, { title: string; hint: string }> = {
      task: { title: "タスクはまだない。", hint: "やるべきことを書いてみて。" },
      note: { title: "メモはまだない。", hint: "思いついたことを書き留めよう。" },
      wish: { title: "ほしいものリストは空。", hint: "いつか欲しいものを書いてみて。" },
      llm: { title: "おつかいはまだない。", hint: "AIに任せたいタスクを作ろう。" },
      done: { title: "完了したものはまだない。", hint: "タスクを完了するとここに表示される。" },
      unprocessed: { title: "未処理はゼロ。", hint: "すべて処理済みです。" },
    };
    const msg = emptyMessages[tab] ?? {
      title: "まだ何もない。",
      hint: "頭の中にあること、なんでも書いてみて。",
    };
    return (
      <div className="empty-state">
        <div className="empty-state-title">{msg.title}</div>
        <div className="empty-state-hint">
          {msg.hint}
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
      {/* Search bar */}
      <div className="entry-search-bar">
        <button
          type="button"
          className="entry-search-toggle"
          onClick={() => {
            setSearchExpanded(!searchExpanded);
            if (!searchExpanded) {
              setTimeout(() => searchInputRef.current?.focus(), 50);
            } else {
              setSearchQuery("");
            }
          }}
          title="検索 (/)"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-label="検索"
            role="img"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <div className={`entry-search-field ${searchExpanded ? "expanded" : ""}`}>
          <input
            ref={searchInputRef}
            type="text"
            className="entry-search-input"
            placeholder="検索... (/ でフォーカス)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onBlur={() => {
              if (!searchQuery) setSearchExpanded(false);
            }}
          />
          {searchQuery && (
            <button
              type="button"
              className="entry-search-clear"
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
            >
              x
            </button>
          )}
        </div>
        {searchQuery && (
          <span className="entry-search-count">
            {filteredItems.length}/{items.length}
          </span>
        )}
      </div>
      <div className="entry-list-layout">
        <div className={`entry-list-main ${selectedEntryId ? "has-detail" : ""}`}>
          {tab === "task" && pending.length === 0 && done.length > 0 && (
            <div className="all-done-state">
              <div className="all-done-title">全部やった！</div>
              <div className="all-done-hint">今日のタスクは全部片付いたよ。おつかれさま。</div>
            </div>
          )}
          {searchQuery && filteredItems.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-title">見つからない。</div>
              <div className="empty-state-hint">「{searchQuery}」に一致するエントリはない。</div>
            </div>
          )}
          {tab === "done" ? (
            <DonePageGroups
              items={filteredItems}
              renderEntry={renderEntry}
              onReopen={(id, feedback) => reopenRef.current({ id, feedback })}
            />
          ) : tab === "llm" ? (
            <>
              {pending.slice(0, visibleCount).map(renderEntry)}
              {pending.length > visibleCount && (
                <button
                  type="button"
                  className="btn-load-more"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                >
                  もっと見る（残り {pending.length - visibleCount} 件）
                </button>
              )}
            </>
          ) : (
            pending.map(renderEntry)
          )}
          {done.length > 0 && <DoneSection items={done} renderEntry={renderEntry} />}
        </div>
        {/* Detail panel */}
        {selectedEntry && (
          <>
            <div
              className="detail-panel-overlay"
              onClick={() => setSelectedEntryId(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSelectedEntryId(null);
              }}
              role="dialog"
              tabIndex={-1}
              aria-label="閉じる"
            />
            <div className="detail-panel">
              <div className="detail-panel-header">
                <h2 className="detail-panel-title">
                  {selectedEntry.title ?? selectedEntry.raw_text}
                </h2>
                <button
                  type="button"
                  className="detail-panel-close"
                  onClick={() => setSelectedEntryId(null)}
                >
                  x
                </button>
              </div>
              <div className="detail-panel-body">
                <div className="detail-panel-meta">
                  {selectedEntry.type && (
                    <span className={`entry-type-badge entry-type-${selectedEntry.type}`}>
                      {selectedEntry.type}
                    </span>
                  )}
                  {selectedEntry.status && (
                    <span
                      className={`detail-panel-status detail-panel-status-${selectedEntry.status}`}
                    >
                      {selectedEntry.status === "done" ? "完了" : "未完了"}
                    </span>
                  )}
                  <span className="detail-panel-date">
                    {new Date(`${selectedEntry.created_at}Z`).toLocaleDateString("ja-JP", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {selectedEntry.tags && selectedEntry.tags.length > 0 && (
                  <div className="detail-panel-tags">
                    {selectedEntry.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="detail-panel-section">
                  <h3 className="detail-panel-section-title">本文</h3>
                  <div className="detail-panel-text">{selectedEntry.raw_text}</div>
                </div>
                {selectedEntry.result && (
                  <div className="detail-panel-section">
                    <h3 className="detail-panel-section-title">結果</h3>
                    <div className="detail-panel-text">
                      <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
                        {selectedEntry.result}
                      </Markdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
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

/* ── Date group helpers for the Done page ── */

interface DateGroup {
  label: string;
  items: EntryRow[];
}

function groupByDate(items: EntryRow[]): DateGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  // Start of this week (Monday-based)
  const dayOfWeek = todayStart.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisWeekStart = new Date(todayStart.getTime() - mondayOffset * 86400000);
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86400000);

  const groups: Record<string, EntryRow[]> = {};
  const groupOrder: string[] = [];

  const addToGroup = (label: string, entry: EntryRow) => {
    if (!groups[label]) {
      groups[label] = [];
      groupOrder.push(label);
    }
    groups[label].push(entry);
  };

  for (const item of items) {
    if (!item.completed_at) {
      addToGroup("それ以前", item);
      continue;
    }
    const completedDate = new Date(`${item.completed_at}Z`);
    if (completedDate >= todayStart) {
      addToGroup("今日", item);
    } else if (completedDate >= yesterdayStart) {
      addToGroup("昨日", item);
    } else if (completedDate >= thisWeekStart) {
      addToGroup("今週", item);
    } else if (completedDate >= lastWeekStart) {
      addToGroup("先週", item);
    } else {
      // Group by month for older items
      const monthLabel = completedDate.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "long",
      });
      addToGroup(monthLabel, item);
    }
  }

  return groupOrder.map((label) => ({ label, items: groups[label] }));
}

const TYPE_LABELS: Record<string, string> = {
  task: "タスク",
  note: "メモ",
  wish: "ほしいもの",
};

function DonePageGroups({
  items,
  renderEntry,
  onReopen,
}: {
  items: EntryRow[];
  renderEntry: (entry: EntryRow) => React.ReactNode;
  onReopen: (id: string, feedback?: string) => void;
}) {
  const DONE_PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(DONE_PAGE_SIZE);
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [reopenFeedback, setReopenFeedback] = useState("");
  const reopenInputRef = useRef<HTMLTextAreaElement>(null);

  const visibleItems = items.slice(0, visibleCount);
  const groups = useMemo(() => groupByDate(visibleItems), [visibleItems]);
  const hasMore = items.length > visibleCount;

  const handleReopen = (id: string) => {
    onReopen(id, reopenFeedback.trim() || undefined);
    setReopenId(null);
    setReopenFeedback("");
  };

  return (
    <>
      {groups.map((group) => (
        <div key={group.label} style={{ marginBottom: 8 }}>
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 5,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              margin: "0 -4px",
              background: "var(--bg, #000)",
              borderBottom: "1px solid var(--border-subtle, #222)",
              fontFamily: "var(--font)",
              fontSize: 12,
            }}
          >
            <span
              style={{ color: "var(--fg-muted, #888)", fontWeight: 600, letterSpacing: "0.5px" }}
            >
              {group.label}
            </span>
            <span
              style={{
                color: "var(--dim, #666)",
                fontSize: 11,
                background: "var(--bg-card, #0a0a0a)",
                border: "1px solid var(--border-subtle, #222)",
                borderRadius: 10,
                padding: "1px 8px",
              }}
            >
              {group.items.length}
            </span>
          </div>
          {group.items.map((entry) => (
            <div key={entry.id} style={{ position: "relative" }}>
              <span
                className={`entry-type-badge entry-type-${entry.type}`}
                style={{
                  position: "absolute",
                  top: 8,
                  right: 32,
                  zIndex: 1,
                  pointerEvents: "none",
                }}
              >
                {TYPE_LABELS[entry.type] ?? entry.type}
              </span>
              {entry.type === "task" && entry.delegatable && (
                <button
                  type="button"
                  className="btn-reopen"
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 56,
                    zIndex: 2,
                    background: "none",
                    border: "1px solid var(--border-subtle, #333)",
                    color: "var(--fg-muted, #888)",
                    fontSize: 11,
                    padding: "1px 8px",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setReopenId(reopenId === entry.id ? null : entry.id);
                    setReopenFeedback("");
                    setTimeout(() => reopenInputRef.current?.focus(), 50);
                  }}
                  title="もう一回やらせる"
                >
                  再実行
                </button>
              )}
              {renderEntry(entry)}
              {reopenId === entry.id && (
                <div
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-card, #0a0a0a)",
                    border: "1px solid var(--border-subtle, #222)",
                    borderRadius: 6,
                    margin: "2px 0 6px",
                  }}
                >
                  <textarea
                    ref={reopenInputRef}
                    value={reopenFeedback}
                    onChange={(e) => setReopenFeedback(e.target.value)}
                    placeholder="追加指示（任意）"
                    rows={2}
                    style={{
                      width: "100%",
                      background: "var(--bg, #000)",
                      color: "var(--fg, #eee)",
                      border: "1px solid var(--border-subtle, #333)",
                      borderRadius: 4,
                      padding: "6px 8px",
                      fontSize: 13,
                      fontFamily: "var(--font)",
                      resize: "vertical",
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleReopen(entry.id);
                      }
                      if (e.key === "Escape") {
                        setReopenId(null);
                        setReopenFeedback("");
                      }
                    }}
                  />
                  <div
                    style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}
                  >
                    <button
                      type="button"
                      style={{
                        background: "none",
                        border: "1px solid var(--border-subtle, #333)",
                        color: "var(--fg-muted, #888)",
                        fontSize: 12,
                        padding: "3px 10px",
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                      onClick={() => {
                        setReopenId(null);
                        setReopenFeedback("");
                      }}
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      style={{
                        background: "var(--accent, #2a6)",
                        border: "none",
                        color: "#000",
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "3px 12px",
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                      onClick={() => handleReopen(entry.id)}
                    >
                      再実行
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      {hasMore && (
        <button
          type="button"
          className="btn-load-more"
          onClick={() => setVisibleCount((c) => c + DONE_PAGE_SIZE)}
        >
          もっと見る（残り {items.length - visibleCount} 件）
        </button>
      )}
    </>
  );
}
