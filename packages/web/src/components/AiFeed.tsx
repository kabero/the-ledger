import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POLL } from "../poll";
import { trpc } from "../trpc";
import { DetailView } from "./ai-feed/DetailView";
import { MiniCard } from "./ai-feed/MiniCard";
import { PromptCopy } from "./ai-feed/PromptCopy";
import type { EntryItem } from "./ai-feed/types";
import { formatTime } from "./ai-feed/utils";
import { ConfirmModal } from "./ConfirmModal";
import { DashFeed } from "./DashFeed";
import { EntryInput } from "./EntryInput";

function formatRelativeTime(isoTime: string): string {
  const now = Date.now();
  const then = new Date(`${isoTime}Z`).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}日前`;
}

const COMPLETED_PAGE_SIZE = 50;

interface AiFeedProps {
  onClose: () => void;
}

export function AiFeed({ onClose }: AiFeedProps) {
  // --- Search state ---
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const isSearching = debouncedQuery.length > 0;

  const searchResults = trpc.listEntries.useQuery(
    { query: debouncedQuery, limit: 50 },
    { enabled: isSearching, refetchInterval: false },
  );

  // --- Pagination state for completed tasks ---
  const [completedCursor, setCompletedCursor] = useState<string | null>(null);
  const [accumulatedCompleted, setAccumulatedCompleted] = useState<EntryItem[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // In-progress delegatable tasks (small set, no pagination needed)
  const delegatableInProgress = trpc.listEntries.useQuery(
    { delegatable: true, limit: 100 },
    { refetchInterval: POLL.delegatable },
  );

  // Completed delegatable tasks — first page with cursor-based pagination
  const completedPage = trpc.listEntriesWithCursor.useQuery(
    { delegatable: true, status: "done", sort: "completed_at", limit: COMPLETED_PAGE_SIZE },
    { refetchInterval: POLL.delegatable },
  );

  // Total count of completed delegatable tasks for the pipeline display
  const completedCount = trpc.countEntries.useQuery(
    { delegatable: true, status: "done" },
    { refetchInterval: POLL.delegatable },
  );

  // Next page fetcher (only enabled when user clicks "load more")
  const nextPage = trpc.listEntriesWithCursor.useQuery(
    {
      delegatable: true,
      status: "done",
      sort: "completed_at",
      limit: COMPLETED_PAGE_SIZE,
      cursor: completedCursor ?? undefined,
    },
    { enabled: completedCursor !== null },
  );

  // Accumulate pages when next page arrives
  useEffect(() => {
    if (nextPage.data && completedCursor !== null) {
      setAccumulatedCompleted((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const newEntries = nextPage.data.entries.filter((e) => !existingIds.has(e.id));
        return [...prev, ...newEntries];
      });
      setIsLoadingMore(false);
    }
  }, [nextPage.data, completedCursor]);

  const sourced = trpc.listEntries.useQuery(
    { source: "any", limit: 100 },
    { refetchInterval: POLL.sourced },
  );
  const unprocessed = trpc.getUnprocessed.useQuery(
    { limit: 50 },
    { refetchInterval: POLL.unprocessed },
  );
  const humanTasks = trpc.listEntries.useQuery(
    { type: "task", status: "pending", limit: 50 },
    { refetchInterval: POLL.humanTasks },
  );
  const awaitingJudgment = trpc.listEntries.useQuery(
    { delegatable: false, limit: 100 },
    { refetchInterval: POLL.pendingDecisions },
  );

  // --- All tasks query for epic tree ---
  // --- Activity timeline: merge completed + in-progress, sort by time ---
  const activityTimeline = useMemo(() => {
    const items: { id: string; title: string; time: string; status: "done" | "pending" }[] = [];
    for (const e of completedPage.data?.entries ?? []) {
      items.push({
        id: e.id,
        title: e.title ?? e.raw_text,
        time: e.completed_at ?? e.created_at,
        status: "done",
      });
    }
    for (const e of (delegatableInProgress.data ?? []).filter((x) => x.status === "pending")) {
      items.push({
        id: e.id,
        title: e.title ?? e.raw_text,
        time: e.created_at,
        status: "pending",
      });
    }
    items.sort((a, b) => new Date(`${b.time}Z`).getTime() - new Date(`${a.time}Z`).getTime());
    return items.slice(0, 10);
  }, [completedPage.data, delegatableInProgress.data]);

  const utils = trpc.useUtils();
  const invalidateAll = () => {
    utils.listEntries.invalidate();
    utils.listEntriesWithCursor.invalidate();
    utils.countEntries.invalidate();
    utils.getUnprocessed.invalidate();
  };
  const updateEntry = trpc.updateEntry.useMutation({ onSuccess: invalidateAll });
  const deleteEntry = trpc.deleteEntry.useMutation({ onSuccess: invalidateAll });
  const markAllSeen = trpc.markAllResultsSeen.useMutation({ onSuccess: invalidateAll });

  // All delegatable items (in-progress only, for pipeline/progress sections)
  const allInProgressItems = delegatableInProgress.data ?? [];
  const allSourced = sourced.data ?? [];
  const unprocessedItems = unprocessed.data ?? [];
  const awaitingItems = awaitingJudgment.data ?? [];
  const humanPending = useMemo(
    () => (humanTasks.data ?? []).filter((e) => !e.delegatable),
    [humanTasks.data],
  );

  const inProgress = useMemo(
    () => allInProgressItems.filter((e) => e.status === "pending"),
    [allInProgressItems],
  );

  // Completed tasks: first page from cursor query + accumulated additional pages
  const completed = useMemo(() => {
    const firstPageEntries = completedPage.data?.entries ?? [];
    if (accumulatedCompleted.length === 0) return firstPageEntries;
    // Deduplicate: first page entries take priority (fresher from polling)
    const firstPageIds = new Set(firstPageEntries.map((e) => e.id));
    const additionalEntries = accumulatedCompleted.filter((e) => !firstPageIds.has(e.id));
    return [...firstPageEntries, ...additionalEntries];
  }, [completedPage.data, accumulatedCompleted]);

  const totalCompletedCount = completedCount.data?.count ?? completed.length;

  // Determine if there are more completed entries to load
  const completedHasMore = useMemo(() => {
    if (completedCursor !== null && nextPage.data) {
      return nextPage.data.nextCursor !== null;
    }
    return (
      completedPage.data?.nextCursor !== null && (completedPage.data?.nextCursor ?? null) !== null
    );
  }, [completedPage.data, nextPage.data, completedCursor]);

  const remainingCompleted = Math.max(0, totalCompletedCount - completed.length);

  const handleLoadMoreCompleted = () => {
    const cursor =
      completedCursor !== null && nextPage.data?.nextCursor
        ? nextPage.data.nextCursor
        : completedPage.data?.nextCursor;
    if (cursor) {
      setIsLoadingMore(true);
      setCompletedCursor(cursor);
    }
  };

  // Deduplicated AI-related entries (for sources breakdown, decisions, etc.)
  const allAi = useMemo(() => {
    const map = new Map<string, EntryItem>();
    for (const e of allInProgressItems) map.set(e.id, e);
    for (const e of completed) map.set(e.id, e);
    for (const e of allSourced) map.set(e.id, e);
    for (const e of awaitingItems) map.set(e.id, e);
    return [...map.values()];
  }, [allInProgressItems, completed, allSourced, awaitingItems]);

  const recentSourced = useMemo(
    () =>
      allAi
        .filter((e) => e.source && !e.delegatable)
        .sort(
          (a, b) => new Date(`${b.created_at}Z`).getTime() - new Date(`${a.created_at}Z`).getTime(),
        )
        .slice(0, 5),
    [allAi],
  );

  const newResults = useMemo(
    () => completed.filter((e) => e.result && !e.result_seen).length,
    [completed],
  );

  // Sources breakdown
  const sources = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of allAi) {
      const s = e.source ?? "manual";
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [allAi]);

  // Entries awaiting human judgment: delegatable tasks where LLM has asked for a decision
  const pendingDecisions = useMemo(
    () =>
      allAi.filter(
        (e) =>
          e.decision_options &&
          e.decision_options.length > 0 &&
          e.decision_selected == null &&
          !e.decision_comment &&
          e.status !== "done",
      ),
    [allAi],
  );
  const [decisionSelected, setDecisionSelected] = useState<Record<string, number | null>>({});
  const [expandedDecisionId, setExpandedDecisionId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [completedVisible, setCompletedVisible] = useState(12);
  const [showAllHumanTasks, setShowAllHumanTasks] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);
  const [decisionComment, setDecisionComment] = useState<Record<string, string>>({});

  // Escape key: go back from detail or close feed
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmDelete) {
        setConfirmDelete(null);
      } else if (selectedId) {
        setSelectedId(null);
      } else {
        onClose();
      }
    },
    [confirmDelete, selectedId, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  // On touch devices, strip keyboard shortcut hints from the input placeholder
  useEffect(() => {
    const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
    if (!isTouchDevice) return;
    const el = document.querySelector<HTMLTextAreaElement>(".ai-feed-input .input-box");
    if (el) {
      el.placeholder = el.placeholder.replace(/\s*\((?:Cmd|Ctrl)\+Shift\+K\)/, "");
    }
  }, []);

  // Resolve selected entry from latest data so it stays in sync with polling
  const selectedEntry = useMemo(() => {
    if (!selectedId) return null;
    return (
      allAi.find((e) => e.id === selectedId) ??
      allInProgressItems.find((e) => e.id === selectedId) ??
      awaitingItems.find((e) => e.id === selectedId) ??
      humanPending.find((e) => e.id === selectedId) ??
      (searchResults.data ?? []).find((e) => e.id === selectedId) ??
      null
    );
  }, [selectedId, allAi, allInProgressItems, awaitingItems, humanPending, searchResults.data]);

  const mutateRef = useRef(updateEntry.mutate);
  mutateRef.current = updateEntry.mutate;

  useEffect(() => {
    if (!selectedEntry) return;
    if (selectedEntry.result && !selectedEntry.result_seen) {
      mutateRef.current({ id: selectedEntry.id, result_seen: true });
    }
  }, [selectedEntry]);

  return (
    <div className={`ai-feed ${selectedEntry ? "has-detail-panel" : ""}`}>
      {selectedEntry && (
        <>
          <div
            className="ai-detail-overlay"
            onClick={() => setSelectedId(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSelectedId(null);
            }}
            role="dialog"
            tabIndex={-1}
            aria-label="閉じる"
          />
          <DetailView entry={selectedEntry} onBack={() => setSelectedId(null)} onClose={onClose} />
        </>
      )}
      {/* Accessibility & mobile fixes: improve pipe-label contrast, hide kbd shortcut on mobile */}
      <style>{`
        .ai-pipe-label {
          font-size: 0.75rem !important;
          color: #bbb !important;
        }
        @media (max-width: 480px) {
          .ai-pipe-label { font-size: 0.6875rem !important; }
        }
        @media (max-width: 375px) {
          .ai-pipe-label { font-size: 0.625rem !important; }
        }
      `}</style>
      {confirmDelete && (
        <ConfirmModal
          message={`「${confirmDelete.label}」を削除しますか？`}
          okLabel="削除"
          onOk={() => {
            deleteEntry.mutate({ id: confirmDelete.id });
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      <div className="ai-feed-header">
        <span className="ai-feed-title">AI Dashboard</span>
        <button type="button" className="gallery-close" aria-label="閉じる" onClick={onClose}>
          x
        </button>
      </div>
      <div className="ai-feed-search">
        <input
          type="text"
          className="ai-feed-search-input"
          placeholder="検索..."
          aria-label="エントリ検索"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="ai-feed-search-clear"
            onClick={() => setSearchQuery("")}
            aria-label="検索をクリア"
          >
            {"\u2715"}
          </button>
        )}
      </div>
      <div className="ai-feed-input">
        <EntryInput />
      </div>

      <div className="ai-dash">
        {isSearching ? (
          <div className="ai-search-results">
            <div className="ai-section-title">
              検索結果
              {searchResults.data && (
                <span className="ai-section-count">{searchResults.data.length}件</span>
              )}
            </div>
            {searchResults.isLoading && <div className="ai-search-loading">検索中...</div>}
            {searchResults.data && searchResults.data.length === 0 && (
              <div className="ai-search-empty">該当するエントリがありません</div>
            )}
            {searchResults.data && searchResults.data.length > 0 && (
              <div className="ai-mini-cards">
                {searchResults.data.map((e) => (
                  <MiniCard
                    key={e.id}
                    entry={e}
                    className={e.status === "done" ? "done" : e.delegatable ? "" : "human"}
                    onClick={() => setSelectedId(e.id)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="ai-dash-top">
              {/* Pipeline */}
              <div className="ai-pipeline">
                <div className="ai-pipe-stage">
                  <div className={`ai-pipe-num ${unprocessedItems.length > 0 ? "danger" : "dim"}`}>
                    {unprocessedItems.length}
                  </div>
                  <div className="ai-pipe-label">未処理</div>
                </div>
                <div className="ai-pipe-arrow">{"\u2192"}</div>
                <div className="ai-pipe-stage">
                  <div className="ai-pipe-num accent">{inProgress.length}</div>
                  <div className="ai-pipe-label">AI進行中</div>
                </div>
                <div className="ai-pipe-arrow">{"\u2192"}</div>
                <div className="ai-pipe-stage">
                  <div className="ai-pipe-num done">{totalCompletedCount}</div>
                  <div className="ai-pipe-label">AI完了</div>
                </div>
                <div className="ai-pipe-sep" />
                {pendingDecisions.length > 0 && (
                  <>
                    <div className="ai-pipe-stage">
                      <div className="ai-pipe-num danger">{pendingDecisions.length}</div>
                      <div className="ai-pipe-label">判断待ち</div>
                    </div>
                    <div className="ai-pipe-sep" />
                  </>
                )}
                <div className="ai-pipe-stage">
                  <div className="ai-pipe-num human">{humanPending.length}</div>
                  <div className="ai-pipe-label">人間タスク</div>
                </div>
                <div className="ai-pipe-stage">
                  <div className={`ai-pipe-num ${newResults > 0 ? "new" : "dim"}`}>
                    {newResults}
                  </div>
                  <div className="ai-pipe-label">未読</div>
                </div>
              </div>

              {/* Sources */}
              {sources.length > 0 && (
                <div className="ai-sources">
                  {sources.map(([name, count]) => (
                    <div key={name} className="ai-source-chip">
                      <span className="ai-source-name">{name}</span>
                      <span className="ai-source-count">{count}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Activity timeline */}
              {activityTimeline.length > 0 && (
                <div className="activity-timeline">
                  <div className="activity-timeline-title">
                    <span className="activity-timeline-title-line" />
                    <span className="activity-timeline-title-text">
                      {"\u30A2\u30AF\u30C6\u30A3\u30D3\u30C6\u30A3"}
                    </span>
                    <span className="activity-timeline-title-line" />
                  </div>
                  <div className="activity-timeline-items">
                    {activityTimeline.map((item) => {
                      const d = new Date(`${item.time}Z`);
                      const hh = String(d.getHours()).padStart(2, "0");
                      const mm = String(d.getMinutes()).padStart(2, "0");
                      const relative = formatRelativeTime(item.time);
                      return (
                        <div key={item.id} className="activity-timeline-row">
                          <div className="activity-timeline-rail">
                            <span className="activity-timeline-time">
                              {hh}:{mm}
                            </span>
                            <span className="activity-timeline-relative">{relative}</span>
                          </div>
                          <div className="activity-timeline-track">
                            <span className={`activity-timeline-dot ${item.status}`} />
                          </div>
                          <div className="activity-timeline-card">
                            <span className="activity-timeline-label">{item.title}</span>
                            <span className={`activity-timeline-status ${item.status}`}>
                              {item.status === "done" ? "\u5B8C\u4E86" : "\u9032\u884C\u4E2D"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="ai-dash-body">
              <div className="ai-dash-main">
                {/* Unprocessed — top priority */}
                <div className="ai-section">
                  <div className="ai-section-title">
                    <span className="ai-dot unprocessed" /> 未処理 ({unprocessedItems.length})
                  </div>
                  {unprocessedItems.length > 0 && (
                    <div className="ai-mini-cards">
                      {unprocessedItems.slice(0, 6).map((e) => (
                        <div key={e.id} className="ai-mini unprocessed">
                          <div className="ai-mini-title">{e.raw_text}</div>
                          <div className="ai-mini-meta">
                            <span className="ai-mini-time">{formatTime(e.created_at)}</span>
                            <button
                              type="button"
                              className="ai-action trash"
                              onClick={() => setConfirmDelete({ id: e.id, label: e.raw_text })}
                              title="削除"
                            >
                              {"\u2715"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pending Decisions — human judgment needed */}
                {pendingDecisions.length > 0 && (
                  <div className="ai-section">
                    <div className="ai-section-title">
                      <span className="ai-dot decision" /> 判断待ち ({pendingDecisions.length})
                    </div>
                    <div className="ai-decision-cards">
                      {pendingDecisions.map((e) => {
                        const hasOptions = e.decision_options && e.decision_options.length > 0;
                        const selected = decisionSelected[e.id] ?? null;
                        const isExpanded = expandedDecisionId === e.id;
                        const isBinary =
                          hasOptions && e.decision_options && e.decision_options.length === 2;
                        return (
                          <div
                            key={e.id}
                            className={`ai-decision-card ${isExpanded ? "expanded" : "compact"}`}
                          >
                            <button
                              type="button"
                              className="ai-decision-compact-row"
                              onClick={() => setExpandedDecisionId(isExpanded ? null : e.id)}
                            >
                              <span className="ai-decision-compact-title">
                                {e.title ?? e.raw_text}
                              </span>
                              {e.tags.length > 0 && (
                                <span className="ai-decision-compact-tags">
                                  {e.tags.map((t) => (
                                    <span key={t} className="tag">
                                      {t}
                                    </span>
                                  ))}
                                </span>
                              )}
                              <span className="ai-mini-time">{formatTime(e.created_at)}</span>
                              <span className="ai-decision-chevron">
                                {isExpanded ? "\u25B2" : "\u25BC"}
                              </span>
                            </button>
                            {/* One-click inline buttons for binary decisions */}
                            {isBinary && !isExpanded && (
                              <div className="ai-decision-inline-actions">
                                {(e.decision_options ?? []).map((opt, idx) => (
                                  <button
                                    key={opt}
                                    type="button"
                                    className="ai-decision-inline-btn"
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      updateEntry.mutate({
                                        id: e.id,
                                        delegatable: true,
                                        decision_selected: idx,
                                        decision_comment: null,
                                      });
                                    }}
                                    title={opt}
                                  >
                                    {opt}
                                  </button>
                                ))}
                              </div>
                            )}
                            <button
                              type="button"
                              className="ai-action trash ai-decision-delete"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setConfirmDelete({ id: e.id, label: e.title ?? e.raw_text });
                              }}
                              title="削除"
                            >
                              {"\u2715"}
                            </button>
                            {isExpanded && (
                              <div className="ai-decision-expanded">
                                <button
                                  type="button"
                                  className="ai-decision-detail-link"
                                  onMouseDown={(ev) => ev.stopPropagation()}
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setSelectedId(e.id);
                                  }}
                                >
                                  詳細を見る
                                </button>
                                {hasOptions && (
                                  <div className="ai-decision-options">
                                    {(e.decision_options ?? []).map((opt, idx) => (
                                      <button
                                        key={opt}
                                        type="button"
                                        className={`ai-decision-opt ${selected === idx ? "selected" : ""}`}
                                        onMouseDown={(ev) => ev.stopPropagation()}
                                        onClick={(ev) => {
                                          ev.stopPropagation();
                                          setDecisionSelected((prev) => ({
                                            ...prev,
                                            [e.id]: prev[e.id] === idx ? null : idx,
                                          }));
                                        }}
                                      >
                                        {opt}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                <input
                                  type="text"
                                  className="ai-decision-comment"
                                  placeholder="コメント（任意）"
                                  aria-label="判断コメント"
                                  value={decisionComment[e.id] ?? ""}
                                  onMouseDown={(ev) => ev.stopPropagation()}
                                  onClick={(ev) => ev.stopPropagation()}
                                  onChange={(ev) =>
                                    setDecisionComment((prev) => ({
                                      ...prev,
                                      [e.id]: ev.target.value,
                                    }))
                                  }
                                />
                                <div className="ai-decision-footer">
                                  <button
                                    type="button"
                                    className="ai-decision-delegate-btn"
                                    onMouseDown={(ev) => ev.stopPropagation()}
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      updateEntry.mutate({
                                        id: e.id,
                                        delegatable: true,
                                        ...(selected != null
                                          ? { decision_selected: selected }
                                          : {}),
                                        decision_comment: decisionComment[e.id] || null,
                                      });
                                      setDecisionSelected((prev) => {
                                        const next = { ...prev };
                                        delete next[e.id];
                                        return next;
                                      });
                                      setDecisionComment((prev) => {
                                        const next = { ...prev };
                                        delete next[e.id];
                                        return next;
                                      });
                                      setExpandedDecisionId(null);
                                    }}
                                  >
                                    {hasOptions && selected != null
                                      ? `「${(e.decision_options ?? [])[selected]}」で決定して委譲`
                                      : "決定して委譲"}
                                  </button>
                                  <button
                                    type="button"
                                    className="ai-decision-delegate-btn"
                                    onMouseDown={(ev) => ev.stopPropagation()}
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      updateEntry.mutate({
                                        id: e.id,
                                        delegatable: false,
                                        type: "task",
                                      });
                                      setExpandedDecisionId(null);
                                    }}
                                  >
                                    人間タスクに変更
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* In Progress */}
                <div className="ai-section">
                  <div className="ai-section-title">
                    <span className="ai-dot progress" /> 進行中 ({inProgress.length})
                  </div>
                  {inProgress.length > 0 && (
                    <div className="ai-mini-cards">
                      {inProgress.map((e) => (
                        <MiniCard
                          key={e.id}
                          entry={e}
                          className={e.urgent ? "urgent" : ""}
                          onClick={() => setSelectedId(e.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent completions — paginated */}
                <div className="ai-section">
                  <div className="ai-section-title">
                    <span className="ai-dot done" /> 最近の完了
                    {totalCompletedCount > completed.length && (
                      <span className="ai-section-count">
                        {completed.length} / {totalCompletedCount}件
                      </span>
                    )}
                    {newResults > 0 && (
                      <button
                        type="button"
                        className="ai-mark-all-seen"
                        onClick={() => markAllSeen.mutate()}
                      >
                        すべて既読
                      </button>
                    )}
                  </div>
                  {completed.length > 0 && (
                    <div className="ai-mini-cards">
                      {completed.slice(0, completedVisible).map((e) => (
                        <MiniCard
                          key={e.id}
                          entry={e}
                          className={`done ${e.result && !e.result_seen ? "has-new" : ""}`}
                          onClick={() => setSelectedId(e.id)}
                          showNew={!!(e.result && !e.result_seen)}
                          timeField="completed_at"
                        />
                      ))}
                    </div>
                  )}
                  {completedVisible < completed.length && (
                    <button
                      type="button"
                      className="ai-show-more"
                      onClick={() => setCompletedVisible((v) => v + 12)}
                    >
                      もっと見る ({completed.length - completedVisible}件)
                    </button>
                  )}
                  {completedVisible >= completed.length && completedHasMore && (
                    <button
                      type="button"
                      className="ai-show-more"
                      onClick={handleLoadMoreCompleted}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore
                        ? "読み込み中..."
                        : `もっと読み込む${remainingCompleted > 0 ? ` (残り${remainingCompleted}件)` : ""}`}
                    </button>
                  )}
                </div>

                {/* Human pending tasks */}
                {humanPending.length > 0 && (
                  <div className="ai-section">
                    <div className="ai-section-title">
                      <span className="ai-dot human" /> 人間タスク ({humanPending.length})
                    </div>
                    <div className="ai-mini-cards">
                      {(showAllHumanTasks ? humanPending : humanPending.slice(0, 6)).map((e) => (
                        <div key={e.id} className="ai-human-card-wrap">
                          <MiniCard
                            entry={e}
                            className={`human ${e.urgent ? "urgent" : ""}`}
                            onClick={() => setSelectedId(e.id)}
                          />
                          <div className="ai-human-actions">
                            <button
                              type="button"
                              className="ai-action done"
                              onClick={() => updateEntry.mutate({ id: e.id, status: "done" })}
                              title="完了"
                            >
                              {"\u2713"}
                            </button>
                            <button
                              type="button"
                              className="ai-action delegate"
                              onClick={() => updateEntry.mutate({ id: e.id, delegatable: true })}
                              title="AIに任せる"
                            >
                              AI
                            </button>
                            <button
                              type="button"
                              className="ai-action trash"
                              onClick={() =>
                                setConfirmDelete({ id: e.id, label: e.title ?? e.raw_text })
                              }
                              title="削除"
                            >
                              {"\u2715"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {humanPending.length > 6 && (
                      <button
                        type="button"
                        className="ai-show-more"
                        onClick={() => setShowAllHumanTasks(!showAllHumanTasks)}
                      >
                        {showAllHumanTasks ? "閉じる" : `もっと見る (${humanPending.length - 6}件)`}
                      </button>
                    )}
                  </div>
                )}

                {/* External inputs (sourced entries) */}
                {recentSourced.length > 0 && (
                  <div className="ai-section">
                    <div className="ai-section-title">
                      <span className="ai-dot source" /> 外部入力
                    </div>
                    <div className="ai-mini-cards">
                      {recentSourced.map((e) => (
                        <MiniCard key={e.id} entry={e} onClick={() => setSelectedId(e.id)} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Development prompts for Agent teams */}
                <PromptCopy />

                {allAi.length === 0 &&
                  unprocessedItems.length === 0 &&
                  humanPending.length === 0 && (
                    <div className="unprocessed-text">アクティビティはまだありません</div>
                  )}
              </div>

              {/* Sidebar: Feed */}
              <div className="ai-dash-sidebar">
                <DashFeed onSelectEntry={setSelectedId} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
