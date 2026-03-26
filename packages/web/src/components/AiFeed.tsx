import { useEffect, useMemo, useState } from "react";
import { trpc } from "../trpc";

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
    { processed: true, limit: 100 },
    { refetchInterval: 5_000 },
  );
  const updateEntry = trpc.updateEntry.useMutation();

  const allItems = delegatable.data ?? [];
  const allSourced = sourced.data ?? [];

  // Deduplicated AI-related entries
  const allAi = useMemo(() => {
    const map = new Map<string, EntryItem>();
    for (const e of allItems) map.set(e.id, e);
    for (const e of allSourced) {
      if (e.source || e.delegatable) map.set(e.id, e);
    }
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
            <div className="ai-detail-result">
              <div
                className="result-markdown"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown rendering
                dangerouslySetInnerHTML={{ __html: simpleMarkdown(selectedEntry.result) }}
              />
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

      <div className="ai-dash">
        {/* Pipeline */}
        <div className="ai-pipeline">
          <div className="ai-pipe-stage">
            <div className="ai-pipe-num accent">{inProgress.length}</div>
            <div className="ai-pipe-label">進行中</div>
          </div>
          <div className="ai-pipe-arrow">{"\u2192"}</div>
          <div className="ai-pipe-stage">
            <div className="ai-pipe-num done">{completed.length}</div>
            <div className="ai-pipe-label">完了</div>
          </div>
          <div className="ai-pipe-sep" />
          <div className="ai-pipe-stage">
            <div className="ai-pipe-num new">{newResults}</div>
            <div className="ai-pipe-label">未読</div>
          </div>
          <div className="ai-pipe-stage">
            <div className="ai-pipe-num dim">{allAi.length}</div>
            <div className="ai-pipe-label">総数</div>
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
                <button
                  type="button"
                  key={e.id}
                  className={`ai-mini ${e.urgent ? "urgent" : ""}`}
                  onClick={() => setSelectedEntry(e)}
                >
                  <div className="ai-mini-title">{e.title ?? e.raw_text}</div>
                  <div className="ai-mini-meta">
                    {e.source && <span className="ai-badge source">{e.source}</span>}
                    <span className="ai-mini-time">{formatTime(e.created_at)}</span>
                  </div>
                </button>
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
              {completed.slice(0, 6).map((e) => {
                const isNew = e.result && !e.result_seen;
                return (
                  <button
                    type="button"
                    key={e.id}
                    className={`ai-mini done ${isNew ? "has-new" : ""}`}
                    onClick={() => setSelectedEntry(e)}
                  >
                    <div className="ai-mini-top">
                      <div className="ai-mini-title">{e.title ?? e.raw_text}</div>
                      {isNew && <span className="ai-badge new">NEW</span>}
                    </div>
                    <div className="ai-mini-meta">
                      {e.completed_at && (
                        <span className="ai-mini-time">{formatTime(e.completed_at)}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
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
                <button
                  type="button"
                  key={e.id}
                  className="ai-mini"
                  onClick={() => setSelectedEntry(e)}
                >
                  <div className="ai-mini-title">{e.title ?? e.raw_text}</div>
                  <div className="ai-mini-meta">
                    <span className="ai-badge source">{e.source}</span>
                    <span className="ai-badge type">{e.type}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {allAi.length === 0 && (
          <div className="unprocessed-text">AIアクティビティはまだありません</div>
        )}
      </div>
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

function simpleMarkdown(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, '<h4 class="result-h">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="result-h">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="result-h">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, '<li class="result-li">$1</li>')
    .replace(/\n/g, "<br />");
}
