import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POLL } from "../poll";
import { trpc } from "../trpc";
import { DetailView } from "./ai-feed/DetailView";
import { MiniCard } from "./ai-feed/MiniCard";
import type { EntryItem } from "./ai-feed/types";
import { formatTime } from "./ai-feed/utils";
import { EntryInput } from "./EntryInput";

interface AiFeedProps {
  onClose: () => void;
}

export function AiFeed({ onClose }: AiFeedProps) {
  // Stagger polling intervals to avoid simultaneous requests
  const delegatable = trpc.listEntries.useQuery(
    { delegatable: true, limit: 100 },
    { refetchInterval: POLL.delegatable },
  );
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
  const utils = trpc.useUtils();
  const invalidateAll = () => {
    utils.listEntries.invalidate();
    utils.getUnprocessed.invalidate();
  };
  const updateEntry = trpc.updateEntry.useMutation({ onSuccess: invalidateAll });
  const deleteEntry = trpc.deleteEntry.useMutation({ onSuccess: invalidateAll });
  const markAllSeen = trpc.markAllResultsSeen.useMutation({ onSuccess: invalidateAll });

  const allItems = delegatable.data ?? [];
  const allSourced = sourced.data ?? [];
  const unprocessedItems = unprocessed.data ?? [];
  const humanPending = useMemo(
    () => (humanTasks.data ?? []).filter((e) => !e.delegatable),
    [humanTasks.data],
  );

  // Deduplicated AI-related entries
  const allAi = useMemo(() => {
    const map = new Map<string, EntryItem>();
    for (const e of allItems) map.set(e.id, e);
    for (const e of allSourced) map.set(e.id, e);
    return [...map.values()];
  }, [allItems, allSourced]);

  const inProgress = useMemo(() => allItems.filter((e) => e.status !== "done"), [allItems]);
  const completed = useMemo(
    () =>
      allItems
        .filter((e) => e.status === "done" && e.result)
        .sort(
          (a, b) =>
            new Date(`${b.completed_at}Z`).getTime() - new Date(`${a.completed_at}Z`).getTime(),
        ),
    [allItems],
  );
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
    () => allItems.filter((e) => e.result && !e.result_seen).length,
    [allItems],
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

  // Decision entries (have options, no selection yet)
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
      allAi.find((e) => e.id === selectedId) ?? allItems.find((e) => e.id === selectedId) ?? null
    );
  }, [selectedId, allAi, allItems]);

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
        <div
          className="result-overlay"
          role="dialog"
          onClick={() => setConfirmDelete(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirmDelete(null);
          }}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation */}
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-message">「{confirmDelete.label}」を削除しますか？</div>
            <div className="confirm-buttons">
              <button
                type="button"
                className="confirm-btn confirm-btn-cancel"
                onClick={() => setConfirmDelete(null)}
              >
                やめる
              </button>
              <button
                type="button"
                className="confirm-btn confirm-btn-ok"
                onClick={() => {
                  deleteEntry.mutate({ id: confirmDelete.id });
                  setConfirmDelete(null);
                }}
              >
                削除
              </button>
            </div>
          </div>
        </div>
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
            <div className="ai-pipe-num done">{completed.length}</div>
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

        {/* In-progress summary report */}
        {inProgress.length > 0 && (
          <div className="ai-progress-summary">
            <div className="ai-progress-summary-title">
              AI 進行中レポート ({inProgress.length}件)
            </div>
            {inProgress.map((e) => (
              <button
                key={e.id}
                type="button"
                className="ai-progress-item"
                onClick={() => setSelectedId(e.id)}
              >
                {e.urgent && <span className="ai-badge urgent">!</span>}
                {e.source && <span className="ai-badge source">{e.source}</span>}
                <span className="ai-progress-item-title">{e.title ?? e.raw_text}</span>
                <span className="ai-progress-item-time">{formatTime(e.created_at)}</span>
              </button>
            ))}
          </div>
        )}

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
              <span className="ai-dot unprocessed" /> 判断待ち ({pendingDecisions.length})
            </div>
            <div className="ai-decision-cards">
              {pendingDecisions.map((e) => (
                <div key={e.id} className="ai-decision-card">
                  <div className="ai-decision-title">{e.title ?? e.raw_text}</div>
                  {e.tags.length > 0 && (
                    <div className="ai-card-tags">
                      {e.tags.map((t) => (
                        <span key={t} className="tag">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="ai-decision-options">
                    {(e.decision_options ?? []).map((opt, idx) => (
                      <button
                        key={opt}
                        type="button"
                        className="ai-decision-opt"
                        onClick={() => {
                          updateEntry.mutate({
                            id: e.id,
                            decision_selected: idx,
                            decision_comment: decisionComment[e.id] || null,
                            status: "done",
                          });
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    className="ai-decision-comment"
                    placeholder="コメント（任意）"
                    value={decisionComment[e.id] ?? ""}
                    onChange={(ev) =>
                      setDecisionComment((prev) => ({ ...prev, [e.id]: ev.target.value }))
                    }
                  />
                  <div className="ai-mini-meta">
                    <span className="ai-mini-time">{formatTime(e.created_at)}</span>
                  </div>
                </div>
              ))}
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

        {/* Recent completions */}
        {completed.length > 0 && (
          <div className="ai-section">
            <div className="ai-section-title">
              <span className="ai-dot done" /> 最近の完了
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
            {completed.length > 6 && (
              <button
                type="button"
                className="ai-show-more"
                onClick={() => setShowAllCompleted(!showAllCompleted)}
              >
                {showAllCompleted ? "閉じる" : `もっと見る (${completed.length - 6}件)`}
              </button>
            )}
          </div>
        )}

        {/* Recent external inputs */}
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

        {/* Human pending tasks */}
        {humanPending.length > 0 && (
          <div className="ai-section">
            <div className="ai-section-title">
              <span className="ai-dot human" /> 人間タスク ({humanPending.length})
            </div>
            <div className="ai-mini-cards">
              {(showAllHumanTasks ? humanPending : humanPending.slice(0, 6)).map((e) => (
                <div key={e.id} className={`ai-mini human ${e.urgent ? "urgent" : ""}`}>
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

        {allAi.length === 0 && unprocessedItems.length === 0 && humanPending.length === 0 && (
          <div className="unprocessed-text">アクティビティはまだありません</div>
        )}
      </div>
    </div>
  );
}
