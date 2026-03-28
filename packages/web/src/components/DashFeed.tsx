import { memo, useCallback, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { remarkPlugins, safeUrlTransform } from "../markdown";
import { POLL } from "../poll";
import { trpc } from "../trpc";
import type { EntryItem } from "./ai-feed/types";
import { formatTime, getResultBadge as getResultBadgeBase, normalizeResult } from "./ai-feed/utils";
import sfStyles from "./SideFeed.module.css";

// ─── Helpers ────────────────────────────────────────────────────

/** ISO date string for 48 hours ago. */
function since48h(): string {
  const d = new Date(Date.now() - 48 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** ISO date-only string for today (local). */
function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const badgeStyles = {
  url: sfStyles["sf-type-url"],
  research: sfStyles["sf-type-research"],
  summary: sfStyles["sf-type-summary"],
  generic: sfStyles["sf-type-generic"],
};

function getResultBadge(entry: EntryItem) {
  return getResultBadgeBase(entry, badgeStyles);
}

/** Status/urgency badge for non-result cards. */
function getStatusBadge(entry: EntryItem): { label: string; className: string } | null {
  if (
    entry.decision_options &&
    entry.decision_options.length > 0 &&
    entry.decision_selected == null
  ) {
    return { label: "判断待ち", className: sfStyles["sf-type-url"] };
  }
  const today = todayDate();
  if (entry.due_date && entry.due_date < today && entry.status !== "done") {
    return { label: "期限超過", className: sfStyles["sf-type-url"] };
  }
  if (entry.urgent && entry.status === "pending") {
    return { label: "緊急", className: sfStyles["sf-type-url"] };
  }
  if (entry.status === "done") {
    return { label: "完了", className: sfStyles["sf-type-generic"] };
  }
  if (entry.status === "in_progress") {
    return { label: "進行中", className: sfStyles["sf-type-research"] };
  }
  if (entry.type === "wish") {
    return { label: "ほしいもの", className: sfStyles["sf-type-summary"] };
  }
  if (entry.type === "note") {
    return { label: "メモ", className: sfStyles["sf-type-generic"] };
  }
  return null;
}

// ─── Card Components ────────────────────────────────────────────

interface DashFeedCardProps {
  entry: EntryItem;
  isExpanded: boolean;
  onToggle: () => void;
  onMarkSeen: (id: string) => void;
  /** Which section this card appears in - affects badge display. */
  section: "attention" | "done" | "recent" | "unread";
}

const DashFeedCard = memo(function DashFeedCard({
  entry,
  isExpanded,
  onToggle,
  onMarkSeen,
  section,
}: DashFeedCardProps) {
  const resultText = entry.result ? normalizeResult(entry.result) : null;
  const isUnread = !!(entry.result && !entry.result_seen);

  // Choose badge based on section context
  const badge =
    section === "attention" || section === "recent" ? getStatusBadge(entry) : getResultBadge(entry);

  const timeLabel = entry.completed_at
    ? formatTime(entry.completed_at)
    : formatTime(entry.created_at);

  const handleClick = () => {
    onToggle();
    if (isUnread && (section === "unread" || section === "done")) {
      onMarkSeen(entry.id);
    }
  };

  return (
    <div
      className={`${sfStyles["sf-card"]} ${isUnread ? sfStyles["sf-card-unread"] : ""} ${isExpanded ? sfStyles["sf-card-expanded"] : ""}`}
    >
      <button type="button" className={sfStyles["sf-card-header"]} onClick={handleClick}>
        <div className={sfStyles["sf-card-top"]}>
          <div className={sfStyles["sf-card-title"]}>{entry.title ?? entry.raw_text}</div>
          <span className={sfStyles["sf-card-time"]}>{timeLabel}</span>
        </div>
        {badge && (
          <div className={sfStyles["sf-card-badges"]}>
            <span className={`${sfStyles["sf-type-badge"]} ${badge.className}`}>{badge.label}</span>
            {entry.tags.slice(0, 2).map((t) => (
              <span key={t} className={sfStyles["sf-tag"]}>
                {t}
              </span>
            ))}
          </div>
        )}
      </button>

      {isExpanded && (
        <div className={sfStyles["sf-card-body"]}>
          {resultText && (
            <div className={sfStyles["sf-card-result"]}>
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
              className={sfStyles["sf-action-link"]}
            >
              {entry.result_url}
            </a>
          )}
          {entry.decision_options &&
            entry.decision_options.length > 0 &&
            entry.decision_selected == null && (
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-subtle)" }}>
                選択肢: {entry.decision_options.join(" / ")}
              </div>
            )}
          {!resultText && !entry.result_url && entry.raw_text !== (entry.title ?? "") && (
            <div className={sfStyles["sf-card-result"]}>
              <p style={{ color: "var(--fg-subtle)" }}>{entry.raw_text}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Section Component ──────────────────────────────────────────

interface FeedSectionProps {
  title: string;
  dotClass: string;
  entries: EntryItem[];
  section: DashFeedCardProps["section"];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onMarkSeen: (id: string) => void;
  defaultVisible?: number;
  showDot?: boolean;
}

function FeedSection({
  title,
  dotClass,
  entries,
  section,
  expandedId,
  onToggle,
  onMarkSeen,
  defaultVisible = 5,
  showDot,
}: FeedSectionProps) {
  const [visibleCount, setVisibleCount] = useState(defaultVisible);

  if (entries.length === 0) return null;

  return (
    <div className="ai-section" style={{ marginBottom: 4 }}>
      <div className="ai-section-title">
        <span className={`ai-dot ${dotClass}`} />
        {title}
        {showDot && <span className={sfStyles["sf-header-dot"]} />}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--dim)" }}>
          {entries.length}
        </span>
      </div>
      <div className="dash-feed-list">
        {entries.slice(0, visibleCount).map((entry) => (
          <DashFeedCard
            key={entry.id}
            entry={entry}
            section={section}
            isExpanded={expandedId === entry.id}
            onToggle={() => onToggle(entry.id)}
            onMarkSeen={onMarkSeen}
          />
        ))}
      </div>
      {visibleCount < entries.length && (
        <button
          type="button"
          className="ai-show-more"
          onClick={() => setVisibleCount((v) => v + defaultVisible)}
        >
          もっと見る ({entries.length - visibleCount}件)
        </button>
      )}
    </div>
  );
}

// ─── Main DashFeed ──────────────────────────────────────────────

interface DashFeedProps {
  onSelectEntry?: (id: string) => void;
}

export function DashFeed({ onSelectEntry }: DashFeedProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const updateEntry = trpc.updateEntry.useMutation({
    onSuccess: () => {
      utils.listEntries.invalidate();
      utils.listEntriesWithCursor.invalidate();
    },
  });
  const mutateRef = useRef(updateEntry.mutate);
  mutateRef.current = updateEntry.mutate;

  // ── Queries ──

  // 1. Pending tasks (for "needs attention": urgent, overdue, decision-pending)
  const pendingQuery = trpc.listEntriesWithCursor.useQuery(
    { status: "pending", limit: 50 },
    { refetchInterval: POLL.entries },
  );

  // 2. In-progress tasks with decisions pending
  const inProgressQuery = trpc.listEntriesWithCursor.useQuery(
    { status: "in_progress", limit: 30 },
    { refetchInterval: POLL.entries },
  );

  // 3. Recent completions
  const doneQuery = trpc.listEntriesWithCursor.useQuery(
    { status: "done", sort: "completed_at", limit: 20 },
    { refetchInterval: POLL.sourced },
  );

  // 4. Recently added (last 48h)
  const recentQuery = trpc.listEntriesWithCursor.useQuery(
    { since: since48h(), sort: "created_at", limit: 20 },
    { refetchInterval: POLL.entries },
  );

  // ── Derived sections ──

  const today = todayDate();

  /** Section 1: Needs Attention */
  const attentionEntries = useMemo(() => {
    const seen = new Set<string>();
    const items: EntryItem[] = [];

    const addUnique = (e: EntryItem) => {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        items.push(e);
      }
    };

    // Decision-pending from any status
    for (const e of [
      ...(inProgressQuery.data?.entries ?? []),
      ...(pendingQuery.data?.entries ?? []),
    ]) {
      if (e.decision_options && e.decision_options.length > 0 && e.decision_selected == null) {
        addUnique(e);
      }
    }

    // Overdue pending tasks
    for (const e of pendingQuery.data?.entries ?? []) {
      if (e.due_date && e.due_date < today) {
        addUnique(e);
      }
    }

    // Urgent pending
    for (const e of pendingQuery.data?.entries ?? []) {
      if (e.urgent) {
        addUnique(e);
      }
    }

    return items;
  }, [pendingQuery.data, inProgressQuery.data, today]);

  /** Section 2: Recent completions */
  const doneEntries = useMemo(() => {
    return doneQuery.data?.entries ?? [];
  }, [doneQuery.data]);

  /** Section 3: Recently added (exclude items already in attention or done) */
  const recentEntries = useMemo(() => {
    const attentionIds = new Set(attentionEntries.map((e) => e.id));
    const doneIds = new Set(doneEntries.map((e) => e.id));
    return (recentQuery.data?.entries ?? []).filter(
      (e) => !attentionIds.has(e.id) && !doneIds.has(e.id),
    );
  }, [recentQuery.data, attentionEntries, doneEntries]);

  /** Section 4: Unread results (from done entries) */
  const unreadEntries = useMemo(() => {
    return doneEntries.filter((e) => e.result && !e.result_seen);
  }, [doneEntries]);

  // ── Handlers ──

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

  // ── Render ──

  const hasAny =
    attentionEntries.length > 0 ||
    doneEntries.length > 0 ||
    recentEntries.length > 0 ||
    unreadEntries.length > 0;

  if (!hasAny) return null;

  return (
    <div className="dash-feed-section" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <FeedSection
        title="要対応"
        dotClass="unprocessed"
        entries={attentionEntries}
        section="attention"
        expandedId={onSelectEntry ? null : expandedId}
        onToggle={handleToggle}
        onMarkSeen={handleMarkSeen}
        defaultVisible={10}
        showDot={attentionEntries.length > 0}
      />

      {unreadEntries.length > 0 && (
        <FeedSection
          title="未読結果"
          dotClass="progress"
          entries={unreadEntries}
          section="unread"
          expandedId={onSelectEntry ? null : expandedId}
          onToggle={handleToggle}
          onMarkSeen={handleMarkSeen}
          defaultVisible={5}
          showDot
        />
      )}

      <FeedSection
        title="最近追加"
        dotClass="source"
        entries={recentEntries}
        section="recent"
        expandedId={onSelectEntry ? null : expandedId}
        onToggle={handleToggle}
        onMarkSeen={handleMarkSeen}
        defaultVisible={5}
      />

      <FeedSection
        title="最近の完了"
        dotClass="done"
        entries={doneEntries}
        section="done"
        expandedId={onSelectEntry ? null : expandedId}
        onToggle={handleToggle}
        onMarkSeen={handleMarkSeen}
        defaultVisible={5}
      />
    </div>
  );
}
