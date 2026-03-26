import { useEffect, useMemo, useState } from "react";
import { trpc } from "../trpc";

type FeedTab = "feed" | "progress" | "done";

interface AiFeedProps {
  onClose: () => void;
}

export function AiFeed({ onClose }: AiFeedProps) {
  const [tab, setTab] = useState<FeedTab>("feed");

  // All delegatable tasks (AI-managed work)
  const delegatable = trpc.listEntries.useQuery(
    { delegatable: true, limit: 100 },
    { refetchInterval: 5_000 },
  );

  // All entries with source (external LLM contributions)
  const sourced = trpc.listEntries.useQuery(
    { processed: true, limit: 100 },
    { refetchInterval: 5_000 },
  );

  const updateEntry = trpc.updateEntry.useMutation();

  const allItems = delegatable.data ?? [];
  const allSourced = sourced.data ?? [];

  // Feed: sourced entries + delegatable, deduplicated, newest first
  const feedItems = useMemo(() => {
    const map = new Map<string, (typeof allItems)[number]>();
    for (const e of allItems) map.set(e.id, e);
    for (const e of allSourced) {
      if (e.source || e.delegatable) map.set(e.id, e);
    }
    return [...map.values()].sort(
      (a, b) => new Date(`${b.created_at}Z`).getTime() - new Date(`${a.created_at}Z`).getTime(),
    );
  }, [allItems, allSourced]);

  const progressItems = useMemo(() => allItems.filter((e) => e.status !== "done"), [allItems]);

  const doneItems = useMemo(
    () =>
      allItems
        .filter((e) => e.status === "done")
        .sort(
          (a, b) =>
            new Date(`${b.completed_at}Z`).getTime() - new Date(`${a.completed_at}Z`).getTime(),
        ),
    [allItems],
  );

  const currentItems = tab === "feed" ? feedItems : tab === "progress" ? progressItems : doneItems;

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Mark result as seen when expanded
  useEffect(() => {
    if (!expandedId) return;
    const item = currentItems.find((e) => e.id === expandedId);
    if (item?.result && !item.result_seen) {
      updateEntry.mutate({ id: expandedId, result_seen: true });
    }
  }, [expandedId, currentItems.find, updateEntry.mutate]);

  const tabs: { key: FeedTab; label: string; count: number }[] = [
    { key: "feed", label: "フィード", count: feedItems.length },
    { key: "progress", label: "進行中", count: progressItems.length },
    { key: "done", label: "完了", count: doneItems.length },
  ];

  return (
    <div className="ai-feed">
      <div className="ai-feed-header">
        <div className="ai-feed-tabs">
          {tabs.map((t) => (
            <button
              type="button"
              key={t.key}
              className={`tab ${tab === t.key ? "active" : ""}`}
              onClick={() => {
                setTab(t.key);
                setExpandedId(null);
              }}
            >
              {t.label}
              {t.count > 0 && <span className="ai-feed-count">{t.count}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="gallery-close" onClick={onClose}>
          x
        </button>
      </div>

      <div className="ai-feed-body">
        {currentItems.length === 0 ? (
          <div className="unprocessed-text">
            {tab === "feed"
              ? "AIアクティビティはまだありません"
              : tab === "progress"
                ? "進行中のおつかいはありません"
                : "完了したおつかいはありません"}
          </div>
        ) : (
          <div className="ai-feed-list">
            {currentItems.map((entry) => (
              <FeedCard
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FeedCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: {
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
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasResult = !!entry.result;
  const isNew = hasResult && !entry.result_seen;

  return (
    <div className={`ai-card ${entry.status === "done" ? "done" : ""}`}>
      <button type="button" className="ai-card-header" onClick={onToggle}>
        <div className="ai-card-top">
          <div className="ai-card-badges">
            {entry.source && <span className="ai-badge source">{entry.source}</span>}
            {entry.type && <span className="ai-badge type">{entry.type}</span>}
            {entry.status === "done" && <span className="ai-badge done">{"\u2713"}</span>}
            {entry.urgent && <span className="ai-badge urgent">!</span>}
            {isNew && <span className="ai-badge new">NEW</span>}
          </div>
          <span className="ai-card-time">{formatTime(entry.created_at)}</span>
        </div>
        <div className="ai-card-title">{entry.title ?? entry.raw_text}</div>
        {entry.tags.length > 0 && (
          <div className="ai-card-tags">
            {entry.tags.map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
          </div>
        )}
        {entry.status === "done" && entry.completed_at && (
          <div className="ai-card-completed">
            完了:{" "}
            {new Date(`${entry.completed_at}Z`).toLocaleDateString("ja-JP", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        )}
      </button>

      {expanded && hasResult && (
        <div className="ai-card-result">
          <div
            className="result-markdown"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown rendering
            dangerouslySetInnerHTML={{ __html: simpleMarkdown(entry.result ?? "") }}
          />
        </div>
      )}
      {expanded && !hasResult && (
        <div className="ai-card-result">
          <div className="ai-card-empty">
            {entry.status === "done" ? "結果なし" : "作業待ち..."}
          </div>
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
