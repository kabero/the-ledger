import { useEffect, useMemo, useRef, useState } from "react";
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
  const delegatable = trpc.listEntries.useQuery(
    { delegatable: true, limit: 100 },
    { refetchInterval: 5_000 },
  );
  const sourced = trpc.listEntries.useQuery(
    { source: "any", limit: 100 },
    { refetchInterval: 5_000 },
  );
  const unprocessed = trpc.getUnprocessed.useQuery({ limit: 50 }, { refetchInterval: 5_000 });
  const humanTasks = trpc.listEntries.useQuery(
    { type: "task", status: "pending", limit: 50 },
    { refetchInterval: 10_000 },
  );
  const utils = trpc.useUtils();
  const invalidateAll = () => {
    utils.listEntries.invalidate();
    utils.getUnprocessed.invalidate();
  };
  const updateEntry = trpc.updateEntry.useMutation({ onSuccess: invalidateAll });
  const deleteEntry = trpc.deleteEntry.useMutation({ onSuccess: invalidateAll });

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

  const [selectedEntry, setSelectedEntry] = useState<EntryItem | null>(null);
  const [showAllCompleted, setShowAllCompleted] = useState(false);

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
        onBack={() => setSelectedEntry(null)}
        onClose={onClose}
        onRetry={(id) => {
          updateEntry.mutate({ id, status: "pending" });
          setSelectedEntry(null);
        }}
      />
    );
  }

  return (
    <div className="ai-feed">
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
                      onClick={() => deleteEntry.mutate({ id: e.id })}
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
                  onClick={() => setSelectedEntry(e)}
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
            </div>
            <div className="ai-mini-cards">
              {(showAllCompleted ? completed : completed.slice(0, 6)).map((e) => (
                <MiniCard
                  key={e.id}
                  entry={e}
                  className={`done ${e.result && !e.result_seen ? "has-new" : ""}`}
                  onClick={() => setSelectedEntry(e)}
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
                <MiniCard key={e.id} entry={e} onClick={() => setSelectedEntry(e)} />
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
              {humanPending.slice(0, 6).map((e) => (
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
          </div>
        )}

        {allAi.length === 0 && unprocessedItems.length === 0 && humanPending.length === 0 && (
          <div className="unprocessed-text">アクティビティはまだありません</div>
        )}
      </div>
    </div>
  );
}
