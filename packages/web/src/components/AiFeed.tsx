import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { trpc } from "../trpc";
import { EntryInput } from "./EntryInput";

function normalizeResult(text: string): string {
  return text.replace(/\\n/g, "\n");
}

interface AiFeedProps {
  onClose: () => void;
}

type EntryItem = {
  id: string;
  title: string | null;
  raw_text: string;
  type: string | null;
  status: string | null;
  source: string | null;
  result: string | null;
  result_seen: boolean;
  urgent: boolean;
  delegatable: boolean;
  created_at: string;
  completed_at: string | null;
  tags: string[];
};

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

  useEffect(() => {
    if (!selectedEntry) return;
    if (selectedEntry.result && !selectedEntry.result_seen) {
      updateEntry.mutate({ id: selectedEntry.id, result_seen: true });
    }
  }, [selectedEntry, updateEntry.mutate]);

  if (selectedEntry) {
    return (
      <div className="ai-feed">
        <div className="ai-feed-header">
          <button type="button" className="ai-detail-back" onClick={() => setSelectedEntry(null)}>
            {"<"} 戻る
          </button>
          <button type="button" className="gallery-close" onClick={onClose}>
            x
          </button>
        </div>
        <div className="ai-detail">
          <div className="ai-detail-meta">
            {selectedEntry.source && (
              <span className="ai-badge source">{selectedEntry.source}</span>
            )}
            <span className="ai-badge type">{selectedEntry.type}</span>
            {selectedEntry.status === "done" && <span className="ai-badge done">{"\u2713"}</span>}
          </div>
          <h2 className="ai-detail-title">{selectedEntry.title ?? selectedEntry.raw_text}</h2>
          <div className="ai-detail-timestamps">
            <span>作成: {formatDateTime(selectedEntry.created_at)}</span>
            {selectedEntry.completed_at && (
              <span>完了: {formatDateTime(selectedEntry.completed_at)}</span>
            )}
          </div>
          {selectedEntry.tags.length > 0 && (
            <div className="ai-card-tags">
              {selectedEntry.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          )}
          {selectedEntry.result ? (
            <>
              <div className="ai-detail-result">
                <Markdown remarkPlugins={[remarkGfm]}>
                  {normalizeResult(selectedEntry.result)}
                </Markdown>
              </div>
              {selectedEntry.status === "done" && selectedEntry.delegatable && (
                <button
                  type="button"
                  className="ai-action-btn retry"
                  onClick={() => {
                    updateEntry.mutate({ id: selectedEntry.id, status: "pending" });
                    setSelectedEntry(null);
                  }}
                >
                  {"\u21BA"} もう一回やらせる
                </button>
              )}
            </>
          ) : selectedEntry.raw_text && selectedEntry.raw_text !== selectedEntry.title ? (
            <div className="ai-detail-result">
              <Markdown remarkPlugins={[remarkGfm]}>
                {normalizeResult(selectedEntry.raw_text)}
              </Markdown>
            </div>
          ) : (
            <div className="ai-detail-empty">
              {selectedEntry.status === "done" ? "結果なし" : "作業待ち..."}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ai-feed">
      <div className="ai-feed-header">
        <span className="ai-feed-title">AI Dashboard</span>
        <button type="button" className="gallery-close" onClick={onClose}>
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

        {/* Unprocessed */}
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

function MiniCard({
  entry,
  className = "",
  onClick,
  showNew = false,
  timeField = "created_at",
}: {
  entry: EntryItem;
  className?: string;
  onClick: () => void;
  showNew?: boolean;
  timeField?: "created_at" | "completed_at";
}) {
  const time = timeField === "completed_at" ? entry.completed_at : entry.created_at;
  const hoverContent = entry.result ?? (entry.raw_text !== entry.title ? entry.raw_text : null);

  return (
    <div className={`ai-mini-wrap ${hoverContent ? "has-tooltip" : ""}`}>
      <button type="button" className={`ai-mini ${className}`} onClick={onClick}>
        <div className="ai-mini-top">
          <div className="ai-mini-title">{entry.title ?? entry.raw_text}</div>
          {showNew && <span className="ai-badge new">NEW</span>}
        </div>
        <div className="ai-mini-meta">
          {entry.source && <span className="ai-badge source">{entry.source}</span>}
          {time && <span className="ai-mini-time">{formatTime(time)}</span>}
        </div>
      </button>
      {hoverContent && (
        <div className="ai-hover-modal">
          <Markdown remarkPlugins={[remarkGfm]}>{normalizeResult(hoverContent)}</Markdown>
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(`${iso}Z`);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}日前`;
  return d.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(`${iso}Z`).toLocaleDateString("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
