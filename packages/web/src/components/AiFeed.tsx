import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POLL } from "../poll";
import { trpc } from "../trpc";
import { ActivityChart } from "./ai-feed/ActivityChart";
import { DetailView } from "./ai-feed/DetailView";
import { MiniCard } from "./ai-feed/MiniCard";
import { PromptCopy } from "./ai-feed/PromptCopy";
import type { EntryItem } from "./ai-feed/types";
import { formatTime } from "./ai-feed/utils";
import { ConfirmModal } from "./ConfirmModal";
import { EntryInput } from "./EntryInput";

const COMPLETED_PAGE_SIZE = 50;

interface AiFeedProps {
  onClose: () => void;
}

export function AiFeed({ onClose }: AiFeedProps) {
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
    () => allInProgressItems.filter((e) => e.status !== "done"),
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
          e.status !== "done",
      ),
    [allAi],
  );
  const [decisionSelected, setDecisionSelected] = useState<Record<string, number | null>>({});
  const [expandedDecisionId, setExpandedDecisionId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAllCompleted, setShowAllCompleted] = useState(false);
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

  // Resolve selected entry from latest data so it stays in sync with polling
  const selectedEntry = useMemo(() => {
    if (!selectedId) return null;
    return (
      allAi.find((e) => e.id === selectedId) ??
      allInProgressItems.find((e) => e.id === selectedId) ??
      awaitingItems.find((e) => e.id === selectedId) ??
      humanPending.find((e) => e.id === selectedId) ??
      null
    );
  }, [selectedId, allAi, allInProgressItems, awaitingItems, humanPending]);

  const mutateRef = useRef(updateEntry.mutate);
  mutateRef.current = updateEntry.mutate;

  useEffect(() => {
    if (!selectedEntry) return;
    if (selectedEntry.result && !selectedEntry.result_seen) {
      mutateRef.current({ id: selectedEntry.id, result_seen: true });
    }
  }, [selectedEntry]);

  if (selectedEntry) {
    return (
      <DetailView
        entry={selectedEntry}
        onBack={() => setSelectedId(null)}
        onClose={onClose}
        onRetry={(id) => {
          updateEntry.mutate({ id, status: "pending" });
          setSelectedId(null);
        }}
      />
    );
  }

  return (
    <div className="ai-feed">
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
      <div className="ai-feed-input">
        <EntryInput />
      </div>

      <div className="ai-dash">
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
              <div className={`ai-pipe-num ${newResults > 0 ? "new" : "dim"}`}>{newResults}</div>
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
        </div>
        <ActivityChart completed={completed} />
        <div className="ai-dash-body">
          <div className="ai-dash-main">
            {/* Unprocessed — top priority */}
            {unprocessedItems.length > 0 && (
              <div className="ai-section">
                <div className="ai-section-title">
                  <span className="ai-dot unprocessed" /> 未処理 ({unprocessedItems.length})
                </div>
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
              </div>
            )}

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
                          <span className="ai-decision-compact-title">{e.title ?? e.raw_text}</span>
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
                                    decision_selected: selected,
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
            {inProgress.length > 0 && (
              <div className="ai-section">
                <div className="ai-section-title">
                  <span className="ai-dot progress" /> 進行中
                </div>
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
              </div>
            )}

            {/* Recent completions — paginated */}
            {completed.length > 0 && (
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
                <div className="ai-mini-cards">
                  {(showAllCompleted ? completed : completed.slice(0, 6)).map((e) => (
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
                {!showAllCompleted && completed.length > 6 && (
                  <button
                    type="button"
                    className="ai-show-more"
                    onClick={() => setShowAllCompleted(true)}
                  >
                    すべて表示 ({completed.length - 6}件)
                  </button>
                )}
                {showAllCompleted && completedHasMore && (
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
                {showAllCompleted && !completedHasMore && completed.length > 6 && (
                  <button
                    type="button"
                    className="ai-show-more"
                    onClick={() => setShowAllCompleted(false)}
                  >
                    閉じる
                  </button>
                )}
              </div>
            )}

            {/* Human pending tasks */}
            {humanPending.length > 0 && (
              <div className="ai-section">
                <div className="ai-section-title">
                  <span className="ai-dot human" /> 人間タスク ({humanPending.length})
                </div>
                <div className="ai-mini-cards">
                  {(showAllHumanTasks ? humanPending : humanPending.slice(0, 6)).map((e) => (
                    <button
                      type="button"
                      key={e.id}
                      className={`ai-mini human ${e.urgent ? "urgent" : ""}`}
                      onClick={() => setSelectedId(e.id)}
                    >
                      <div className="ai-mini-title">{e.title ?? e.raw_text}</div>
                      {e.tags.length > 0 && (
                        <div className="ai-card-tags">
                          {e.tags.map((t) => (
                            <span key={t} className="tag">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="ai-mini-meta">
                        {e.due_date && <span className="ai-badge type">{e.due_date}</span>}
                        {e.urgent && <span className="ai-badge urgent">!</span>}
                        <span className="ai-mini-time">{formatTime(e.created_at)}</span>
                      </div>
                      <div className="ai-actions">
                        <button
                          type="button"
                          className="ai-action done"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            updateEntry.mutate({ id: e.id, status: "done" });
                          }}
                          title="完了"
                        >
                          {"\u2713"}
                        </button>
                        <button
                          type="button"
                          className="ai-action delegate"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            updateEntry.mutate({ id: e.id, delegatable: true });
                          }}
                          title="AIに任せる"
                        >
                          AI
                        </button>
                      </div>
                    </button>
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

            {/* Development prompts for Agent teams */}
            <PromptCopy />

            {allAi.length === 0 && unprocessedItems.length === 0 && humanPending.length === 0 && (
              <div className="unprocessed-text">アクティビティはまだありません</div>
            )}
          </div>

          {/* Sidebar: Recent external inputs */}
          {recentSourced.length > 0 && (
            <div className="ai-dash-sidebar">
              <div className="ai-section">
                <div className="ai-section-title">
                  <span className="ai-dot source" /> 外部入力
                </div>
                <div className="ai-sidebar-cards">
                  {recentSourced.map((e) => (
                    <MiniCard key={e.id} entry={e} onClick={() => setSelectedId(e.id)} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
