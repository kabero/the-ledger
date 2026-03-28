import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POLL } from "../poll";
import { trpc } from "../trpc";
import { CompletedSection } from "./ai-feed/CompletedSection";
import { DetailView } from "./ai-feed/DetailView";
import { HumanTasksSection } from "./ai-feed/HumanTasksSection";
import { InProgressSection } from "./ai-feed/InProgressSection";
import { MiniCard } from "./ai-feed/MiniCard";
import { PendingDecisionsSection } from "./ai-feed/PendingDecisionsSection";
import { PromptCopy } from "./ai-feed/PromptCopy";
import { SourcedSection } from "./ai-feed/SourcedSection";
import type { EntryItem } from "./ai-feed/types";
import { formatTime } from "./ai-feed/utils";
import { ConfirmModal } from "./ConfirmModal";
import { DashFeed } from "./DashFeed";
import { EntryInput } from "./EntryInput";

/** Return urgency CSS class based on entry properties. */
export function getUrgencyClass(entry: EntryItem): string {
  const today = new Date().toISOString().slice(0, 10);
  if (entry.due_date && entry.due_date < today && entry.status !== "done") return "urgency-overdue";
  if (
    entry.decision_options &&
    entry.decision_options.length > 0 &&
    entry.decision_selected == null
  )
    return "urgency-decision";
  if (entry.urgent && entry.status !== "done") return "urgency-urgent";
  return "";
}

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
  // --- Source filter state ---
  const [activeSourceFilters, setActiveSourceFilters] = useState<Set<string>>(new Set());

  const toggleSourceFilter = useCallback((source: string) => {
    setActiveSourceFilters((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  }, []);

  const clearSourceFilters = useCallback(() => {
    setActiveSourceFilters(new Set());
  }, []);

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

  // --- Aggregated dashboard query (replaces 6 separate queries) ---
  const dashboard = trpc.getDashboardData.useQuery(undefined, {
    refetchInterval: POLL.dashboard,
  });

  // Next page fetcher for completed tasks (only enabled when user clicks "load more")
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

  // Sourced entries — not included in getDashboardData, kept as separate query
  const sourced = trpc.listEntries.useQuery(
    { source: "any", limit: 100 },
    { refetchInterval: POLL.sourced },
  );

  // --- Derived data from aggregated dashboard query ---
  const dashData = dashboard.data;
  const allSourced = sourced.data ?? [];
  const unprocessedItems = dashData?.unprocessed ?? [];
  const awaitingItems = dashData?.pendingDecisions ?? [];
  // Split delegatable pending into classified (no result yet) and in-progress (has result)
  const allDelegatablePending = dashData?.inProgress ?? [];
  const classified = allDelegatablePending.filter((e) => !e.result);
  const inProgress = allDelegatablePending.filter((e) => !!e.result);
  const humanPending = useMemo(
    () => (dashData?.humanTasks ?? []).filter((e) => !e.delegatable),
    [dashData?.humanTasks],
  );

  // Completed tasks: first page from dashboard + accumulated additional pages
  const completed = useMemo(() => {
    const firstPageEntries = dashData?.completed.entries ?? [];
    if (accumulatedCompleted.length === 0) return firstPageEntries;
    // Deduplicate: first page entries take priority (fresher from polling)
    const firstPageIds = new Set(firstPageEntries.map((e) => e.id));
    const additionalEntries = accumulatedCompleted.filter((e) => !firstPageIds.has(e.id));
    return [...firstPageEntries, ...additionalEntries];
  }, [dashData?.completed, accumulatedCompleted]);

  const totalCompletedCount = dashData?.completedCount ?? completed.length;

  // Determine if there are more completed entries to load
  const completedHasMore = useMemo(() => {
    if (completedCursor !== null && nextPage.data) {
      return nextPage.data.nextCursor !== null;
    }
    return (
      dashData?.completed.nextCursor !== null && (dashData?.completed.nextCursor ?? null) !== null
    );
  }, [dashData?.completed, nextPage.data, completedCursor]);

  const remainingCompleted = Math.max(0, totalCompletedCount - completed.length);

  const handleLoadMoreCompleted = () => {
    const cursor =
      completedCursor !== null && nextPage.data?.nextCursor
        ? nextPage.data.nextCursor
        : dashData?.completed.nextCursor;
    if (cursor) {
      setIsLoadingMore(true);
      setCompletedCursor(cursor);
    }
  };

  // --- Activity timeline: merge completed + in-progress, sort by time ---
  const activityTimeline = useMemo(() => {
    const items: { id: string; title: string; time: string; status: "done" | "pending" }[] = [];
    for (const e of dashData?.completed.entries ?? []) {
      items.push({
        id: e.id,
        title: e.title ?? e.raw_text,
        time: e.completed_at ?? e.created_at,
        status: "done",
      });
    }
    for (const e of inProgress) {
      items.push({
        id: e.id,
        title: e.title ?? e.raw_text,
        time: e.created_at,
        status: "pending",
      });
    }
    items.sort((a, b) => new Date(`${b.time}Z`).getTime() - new Date(`${a.time}Z`).getTime());
    return items.slice(0, 10);
  }, [dashData?.completed, inProgress]);

  const utils = trpc.useUtils();
  const invalidateAll = () => {
    utils.getDashboardData.invalidate();
    utils.listEntries.invalidate();
    utils.listEntriesWithCursor.invalidate();
  };
  const updateEntry = trpc.updateEntry.useMutation({ onSuccess: invalidateAll });
  const deleteEntry = trpc.deleteEntry.useMutation({ onSuccess: invalidateAll });
  const markAllSeen = trpc.markAllResultsSeen.useMutation({ onSuccess: invalidateAll });

  // Deduplicated AI-related entries (for sources breakdown, decisions, etc.)
  const allAi = useMemo(() => {
    const map = new Map<string, EntryItem>();
    for (const e of classified) map.set(e.id, e);
    for (const e of inProgress) map.set(e.id, e);
    for (const e of completed) map.set(e.id, e);
    for (const e of allSourced) map.set(e.id, e);
    for (const e of awaitingItems) map.set(e.id, e);
    return [...map.values()];
  }, [classified, inProgress, completed, allSourced, awaitingItems]);

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
  const handleDelete = useCallback(
    (id: string, label: string) => setConfirmDelete({ id, label }),
    [],
  );
  const [decisionComment, setDecisionComment] = useState<Record<string, string>>({});

  // --- Section refs for KPI scroll ---
  const sectionUnprocessedRef = useRef<HTMLDivElement>(null);
  const sectionInProgressRef = useRef<HTMLDivElement>(null);
  const sectionCompletedRef = useRef<HTMLDivElement>(null);
  const sectionDecisionsRef = useRef<HTMLDivElement>(null);
  const sectionHumanRef = useRef<HTMLDivElement>(null);

  const scrollToSection = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // --- KPI tap feedback ---
  const [tappedKpi, setTappedKpi] = useState<string | null>(null);
  const handleKpiTap = useCallback(
    (key: string, ref: React.RefObject<HTMLDivElement | null>) => {
      setTappedKpi(key);
      scrollToSection(ref);
      setTimeout(() => setTappedKpi(null), 300);
    },
    [scrollToSection],
  );

  // --- Source-based entry filtering ---
  const filterBySource = useCallback(
    (entries: EntryItem[]) => {
      if (activeSourceFilters.size === 0) return entries;
      return entries.filter((e) => {
        const src = e.source ?? "manual";
        return activeSourceFilters.has(src);
      });
    },
    [activeSourceFilters],
  );

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
      inProgress.find((e) => e.id === selectedId) ??
      awaitingItems.find((e) => e.id === selectedId) ??
      humanPending.find((e) => e.id === selectedId) ??
      (searchResults.data ?? []).find((e) => e.id === selectedId) ??
      null
    );
  }, [selectedId, allAi, inProgress, awaitingItems, humanPending, searchResults.data]);

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
                    onDelete={handleDelete}
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
                <button
                  type="button"
                  className={`ai-pipe-stage tappable ${tappedKpi === "unprocessed" ? "tapped" : ""}`}
                  onClick={() => handleKpiTap("unprocessed", sectionUnprocessedRef)}
                >
                  <div
                    className={`ai-pipe-num actionable ${unprocessedItems.length > 0 ? "danger glow" : "dim"}`}
                  >
                    {unprocessedItems.length}
                  </div>
                  <div className="ai-pipe-label">未処理</div>
                </button>
                <div className="ai-pipe-arrow">{"\u2192"}</div>
                <div className="ai-pipe-stage">
                  <div className="ai-pipe-num muted">{classified.length}</div>
                  <div className="ai-pipe-label">分類済み</div>
                </div>
                <div className="ai-pipe-arrow">{"\u2192"}</div>
                <button
                  type="button"
                  className={`ai-pipe-stage tappable ${tappedKpi === "inprogress" ? "tapped" : ""}`}
                  onClick={() => handleKpiTap("inprogress", sectionInProgressRef)}
                >
                  <div className="ai-pipe-num actionable accent">{inProgress.length}</div>
                  <div className="ai-pipe-label">進行中</div>
                </button>
                <div className="ai-pipe-arrow">{"\u2192"}</div>
                <button
                  type="button"
                  className={`ai-pipe-stage tappable ${tappedKpi === "completed" ? "tapped" : ""}`}
                  onClick={() => handleKpiTap("completed", sectionCompletedRef)}
                >
                  <div className="ai-pipe-num actionable done">{totalCompletedCount}</div>
                  <div className="ai-pipe-label">完了</div>
                </button>
                <div className="ai-pipe-sep" />
                {pendingDecisions.length > 0 && (
                  <>
                    <button
                      type="button"
                      className={`ai-pipe-stage tappable ${tappedKpi === "decisions" ? "tapped" : ""}`}
                      onClick={() => handleKpiTap("decisions", sectionDecisionsRef)}
                    >
                      <div className="ai-pipe-num actionable danger glow">
                        {pendingDecisions.length}
                      </div>
                      <div className="ai-pipe-label">判断待ち</div>
                    </button>
                    <div className="ai-pipe-sep" />
                  </>
                )}
                <button
                  type="button"
                  className={`ai-pipe-stage tappable ${tappedKpi === "human" ? "tapped" : ""}`}
                  onClick={() => handleKpiTap("human", sectionHumanRef)}
                >
                  <div className="ai-pipe-num actionable human">{humanPending.length}</div>
                  <div className="ai-pipe-label">人間タスク</div>
                </button>
                <button
                  type="button"
                  className={`ai-pipe-stage tappable ${tappedKpi === "newresults" ? "tapped" : ""}`}
                  onClick={() => handleKpiTap("newresults", sectionCompletedRef)}
                >
                  <div
                    className={`ai-pipe-num ${newResults > 0 ? "actionable new glow" : "muted"}`}
                  >
                    {newResults}
                  </div>
                  <div className="ai-pipe-label">未読</div>
                </button>
              </div>

              {/* Sources */}
              {sources.length > 0 && (
                <div className="ai-sources">
                  {activeSourceFilters.size > 0 && (
                    <button
                      type="button"
                      className="ai-source-chip ai-source-all"
                      onClick={clearSourceFilters}
                    >
                      <span className="ai-source-name">all</span>
                    </button>
                  )}
                  {sources.map(([name, count]) => (
                    <button
                      type="button"
                      key={name}
                      className={`ai-source-chip ${activeSourceFilters.has(name) ? "active" : ""}`}
                      onClick={() => toggleSourceFilter(name)}
                    >
                      <span className="ai-source-name">{name}</span>
                      <span className="ai-source-count">{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="ai-dash-body">
              <div className="ai-dash-main">
                {/* Unprocessed — top priority */}
                <div className="ai-section" ref={sectionUnprocessedRef}>
                  <div className="ai-section-title">
                    <span className="ai-dot unprocessed" /> 未処理 (
                    {filterBySource(unprocessedItems).length})
                  </div>
                  {filterBySource(unprocessedItems).length > 0 && (
                    <div className="ai-mini-cards">
                      {filterBySource(unprocessedItems)
                        .slice(0, 6)
                        .map((e) => (
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

                <div ref={sectionDecisionsRef} />
                <PendingDecisionsSection
                  entries={filterBySource(pendingDecisions)}
                  expandedId={expandedDecisionId}
                  decisionSelected={decisionSelected}
                  decisionComment={decisionComment}
                  onExpand={setExpandedDecisionId}
                  onSelect={(id, idx) => setDecisionSelected((prev) => ({ ...prev, [id]: idx }))}
                  onCommentChange={(id, value) =>
                    setDecisionComment((prev) => ({ ...prev, [id]: value }))
                  }
                  onSubmit={(e, selected, comment) => {
                    updateEntry.mutate({
                      id: e.id,
                      delegatable: true,
                      ...(selected != null ? { decision_selected: selected } : {}),
                      decision_comment: comment,
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
                  onConvertToHuman={(e) => {
                    updateEntry.mutate({ id: e.id, delegatable: false, type: "task" });
                    setExpandedDecisionId(null);
                  }}
                  onDelete={handleDelete}
                  onOpenDetail={setSelectedId}
                  onInlineDecide={(e, idx) => {
                    updateEntry.mutate({
                      id: e.id,
                      delegatable: true,
                      decision_selected: idx,
                      decision_comment: null,
                    });
                  }}
                />

                {/* Classified: delegatable pending, not yet started (no result) */}
                {classified.length > 0 && (
                  <div className="ai-section">
                    <div className="ai-section-title">
                      <span className="ai-dot classified" /> 分類済み ({classified.length})
                    </div>
                    <div className="ai-mini-cards">
                      {filterBySource(classified).map((e) => (
                        <MiniCard
                          key={e.id}
                          entry={e}
                          className={e.urgent ? "urgent" : ""}
                          onClick={() => setSelectedId(e.id)}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={sectionInProgressRef} />
                <InProgressSection
                  entries={filterBySource(inProgress)}
                  onSelect={setSelectedId}
                  onDelete={handleDelete}
                />
                <div ref={sectionCompletedRef} />
                <CompletedSection
                  entries={filterBySource(completed)}
                  completedVisible={completedVisible}
                  totalCompletedCount={totalCompletedCount}
                  newResults={newResults}
                  completedHasMore={completedHasMore}
                  remainingCompleted={remainingCompleted}
                  isLoadingMore={isLoadingMore}
                  onSelect={setSelectedId}
                  onDelete={handleDelete}
                  onShowMore={() => setCompletedVisible((v) => v + 12)}
                  onLoadMore={handleLoadMoreCompleted}
                  onMarkAllSeen={() => markAllSeen.mutate()}
                />
                <div ref={sectionHumanRef} />
                <HumanTasksSection
                  entries={filterBySource(humanPending)}
                  showAll={showAllHumanTasks}
                  onSelect={setSelectedId}
                  onToggleShowAll={() => setShowAllHumanTasks(!showAllHumanTasks)}
                  onMarkDone={(id) => updateEntry.mutate({ id, status: "done" })}
                  onDelegate={(id) => updateEntry.mutate({ id, delegatable: true })}
                  onDelete={handleDelete}
                />
                <SourcedSection
                  entries={filterBySource(recentSourced)}
                  onSelect={setSelectedId}
                  onDelete={handleDelete}
                />

                {/* Development prompts for Agent teams */}
                <PromptCopy />

                {allAi.length === 0 &&
                  unprocessedItems.length === 0 &&
                  humanPending.length === 0 && (
                    <div className="unprocessed-text">アクティビティはまだありません</div>
                  )}
              </div>

              {/* Feed (middle column) */}
              <div className="ai-dash-sidebar">
                <DashFeed onSelectEntry={setSelectedId} />
              </div>

              {/* Activity (right column) */}
              <div className="ai-dash-activity">
                {activityTimeline.length > 0 ? (
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
                ) : (
                  <div className="unprocessed-text">アクティビティはまだありません</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
