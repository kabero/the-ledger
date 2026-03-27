import { memo, useCallback, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { remarkPlugins, safeUrlTransform } from "../markdown";
import { POLL } from "../poll";
import { trpc } from "../trpc";
import type { EntryItem } from "./ai-feed/types";
import { normalizeResult } from "./ai-feed/utils";

/** Classify the result type for badge display. */
function getResultBadge(entry: EntryItem): { label: string; className: string } | null {
  if (entry.result_url) {
    return { label: "URL", className: "sf-type-url" };
  }
  if (!entry.result) return null;

  const lower = normalizeResult(entry.result).toLowerCase();

  if (
    lower.includes("調査") ||
    lower.includes("リサーチ") ||
    lower.includes("research") ||
    lower.includes("investigation") ||
    lower.includes("分析") ||
    lower.includes("検証")
  ) {
    return { label: "調査", className: "sf-type-research" };
  }

  if (
    lower.includes("サマリ") ||
    lower.includes("まとめ") ||
    lower.includes("要約") ||
    lower.includes("summary") ||
    lower.includes("概要")
  ) {
    return { label: "サマリ", className: "sf-type-summary" };
  }

  return { label: "結果あり", className: "sf-type-generic" };
}

interface DashFeedCardProps {
  entry: EntryItem;
  isExpanded: boolean;
  onToggle: () => void;
  onMarkSeen: (id: string) => void;
}

const DashFeedCard = memo(function DashFeedCard({
  entry,
  isExpanded,
  onToggle,
  onMarkSeen,
}: DashFeedCardProps) {
  const resultText = entry.result ? normalizeResult(entry.result) : null;
  const isUnread = !!(entry.result && !entry.result_seen);
  const badge = getResultBadge(entry);

  const handleClick = () => {
    onToggle();
    if (isUnread) {
      onMarkSeen(entry.id);
    }
  };

  return (
    <div
      className={`sf-card ${isUnread ? "sf-card-unread" : ""} ${isExpanded ? "sf-card-expanded" : ""}`}
    >
      <button type="button" className="sf-card-header" onClick={handleClick}>
        <div className="sf-card-title">{entry.title ?? entry.raw_text}</div>
        {badge && <span className={`sf-type-badge ${badge.className}`}>{badge.label}</span>}
      </button>

      {isExpanded && (
        <div className="sf-card-body">
          {resultText && (
            <div className="sf-card-result">
              <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
                {resultText}
              </Markdown>
            </div>
          )}
          {entry.result_url && (
            <a
              href={entry.result_url}
              target="_blank"
              rel="noopener noreferrer"
              className="sf-action-link"
            >
              {entry.result_url}
            </a>
          )}
        </div>
      )}
    </div>
  );
});

interface DashFeedProps {
  onSelectEntry?: (id: string) => void;
}

const DASH_FEED_INITIAL = 10;

export function DashFeed({ onSelectEntry }: DashFeedProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(DASH_FEED_INITIAL);

  const utils = trpc.useUtils();
  const updateEntry = trpc.updateEntry.useMutation({
    onSuccess: () => {
      utils.listEntries.invalidate();
      utils.listEntriesWithCursor.invalidate();
    },
  });
  const mutateRef = useRef(updateEntry.mutate);
  mutateRef.current = updateEntry.mutate;

  const feedQuery = trpc.listEntriesWithCursor.useQuery(
    { status: "done", sort: "completed_at", limit: 30 },
    { refetchInterval: POLL.sourced },
  );

  const entries = useMemo(() => {
    const all = feedQuery.data?.entries ?? [];
    return all.filter((e) => e.result || e.result_url);
  }, [feedQuery.data]);

  const handleToggle = useCallback(
    (id: string) => {
      if (onSelectEntry) {
        onSelectEntry(id);
      } else {
        setExpandedId((prev) => (prev === id ? null : id));
      }
    },
    [onSelectEntry],
  );

  const handleMarkSeen = useCallback((id: string) => {
    mutateRef.current({ id, result_seen: true });
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="ai-section dash-feed-section">
      <div className="ai-section-title">
        <span className="ai-dot done" /> フィード
        {entries.some((e) => e.result && !e.result_seen) && <span className="sf-header-dot" />}
      </div>
      <div className="dash-feed-list">
        {entries.slice(0, visibleCount).map((entry) => (
          <DashFeedCard
            key={entry.id}
            entry={entry}
            isExpanded={!onSelectEntry && expandedId === entry.id}
            onToggle={() => handleToggle(entry.id)}
            onMarkSeen={handleMarkSeen}
          />
        ))}
      </div>
      {visibleCount < entries.length && (
        <button
          type="button"
          className="ai-show-more"
          onClick={() => setVisibleCount((v) => v + DASH_FEED_INITIAL)}
        >
          もっと見る ({entries.length - visibleCount}件)
        </button>
      )}
    </div>
  );
}
