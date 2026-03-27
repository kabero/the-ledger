import { memo, useCallback, useMemo, useRef, useState } from "react";
import { POLL } from "../poll";
import { trpc } from "../trpc";
import type { EntryItem } from "./ai-feed/types";
import { normalizeResult } from "./ai-feed/utils";
import styles from "./SideFeed.module.css";

const PAGE_SIZE = 30;

/** Classify the result type for badge display. */
function getResultBadge(entry: EntryItem): { label: string; className: string } | null {
  if (entry.result_url) {
    return { label: "URL", className: styles["sf-type-url"] };
  }
  if (!entry.result) return null;

  const text = normalizeResult(entry.result);
  const lower = text.toLowerCase();

  // Heuristic: research / investigation
  if (
    lower.includes("調査") ||
    lower.includes("リサーチ") ||
    lower.includes("research") ||
    lower.includes("investigation") ||
    lower.includes("分析") ||
    lower.includes("検証")
  ) {
    return { label: "調査", className: styles["sf-type-research"] };
  }

  // Heuristic: summary
  if (
    lower.includes("サマリ") ||
    lower.includes("まとめ") ||
    lower.includes("要約") ||
    lower.includes("summary") ||
    lower.includes("概要")
  ) {
    return { label: "サマリ", className: styles["sf-type-summary"] };
  }

  // Generic result
  return { label: "結果あり", className: styles["sf-type-generic"] };
}

interface FeedCardProps {
  entry: EntryItem;
  onMarkSeen: (id: string) => void;
  onCopy: (text: string) => void;
}

const FeedCard = memo(function FeedCard({ entry, onMarkSeen }: Omit<FeedCardProps, "onCopy">) {
  const isUnread = !!(entry.result && !entry.result_seen);
  const badge = getResultBadge(entry);

  const handleClick = () => {
    if (isUnread) {
      onMarkSeen(entry.id);
    }
  };

  return (
    <div className={`${styles["sf-card"]} ${isUnread ? styles["sf-card-unread"] : ""}`}>
      <button type="button" className={styles["sf-card-header"]} onClick={handleClick}>
        <div className={styles["sf-card-title"]}>{entry.title ?? entry.raw_text}</div>
        {badge && (
          <span className={`${styles["sf-type-badge"]} ${badge.className}`}>{badge.label}</span>
        )}
      </button>
    </div>
  );
});

export function SideFeed() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    { status: "done", sort: "completed_at", limit: PAGE_SIZE },
    { refetchInterval: POLL.sourced },
  );

  const entries = useMemo(() => {
    const all = feedQuery.data?.entries ?? [];
    return all.filter((e) => {
      const badge = getResultBadge(e);
      // Only show research, summary, or URL results — skip generic "結果あり"
      return badge && badge.className !== styles["sf-type-generic"];
    });
  }, [feedQuery.data]);

  const handleMarkSeen = useCallback((id: string) => {
    mutateRef.current({ id, result_seen: true });
  }, []);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId("copied");
      setTimeout(() => setCopiedId(null), 1500);
    });
  }, []);

  if (entries.length === 0) return null;

  return (
    <aside className={styles["sf-sidebar"]}>
      <div className={styles["sf-header"]}>
        <span className={styles["sf-header-title"]}>フィード</span>
        {entries.some((e) => e.result && !e.result_seen) && (
          <span className={styles["sf-header-dot"]} />
        )}
      </div>
      {copiedId && <div className={styles["sf-toast"]}>コピーしました</div>}
      <div className={styles["sf-list"]}>
        {entries.map((entry) => (
          <FeedCard key={entry.id} entry={entry} onMarkSeen={handleMarkSeen} onCopy={handleCopy} />
        ))}
      </div>
    </aside>
  );
}
