import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { AiFeed } from "./components/AiFeed";
import { EntryInput } from "./components/EntryInput";
import { EntryList } from "./components/EntryList";
import { Gallery } from "./components/Gallery";
import { applyFont, Settings } from "./components/Settings";
import { remarkPlugins, safeUrlTransform } from "./markdown";
import { POLL } from "./poll";
import { trpc } from "./trpc";

type Tab = "all" | "task" | "note" | "wish" | "done" | "unprocessed" | "llm";

const MAIN_TABS: { key: Tab; label: string }[] = [
  { key: "task", label: "タスク" },
  { key: "llm", label: "おつかい" },
  { key: "note", label: "メモ" },
  { key: "wish", label: "ほしい" },
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("task");
  const [showGallery, setShowGallery] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAiFeed, setShowAiFeed] = useState(false);
  const [showMobileInput, setShowMobileInput] = useState(false);
  const [showSourcedModal, setShowSourcedModal] = useState(false);

  useEffect(() => {
    applyFont();
  }, []);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchEndX = useRef(0);
  const touchEndY = useRef(0);

  // Disable polling when AiFeed is open (it has its own queries)
  const unprocessed = trpc.getUnprocessed.useQuery(
    { limit: 50 },
    { refetchInterval: showAiFeed ? false : POLL.unprocessed },
  );
  const unprocessedCount = unprocessed.data?.length ?? 0;

  // Check for unseen AI results
  const aiTasks = trpc.listEntries.useQuery(
    { delegatable: true, limit: 100 },
    { refetchInterval: showAiFeed ? false : POLL.delegatable },
  );
  const hasNewAiResults = useMemo(
    () => (aiTasks.data ?? []).some((e) => e.result && !e.result_seen),
    [aiTasks.data],
  );

  // Overdue task detection
  const pendingTasks = trpc.listEntries.useQuery(
    { type: "task", status: "pending", limit: 100 },
    { refetchInterval: showAiFeed ? false : POLL.entries },
  );
  const [overdueDismissed, setOverdueDismissed] = useState(false);
  const overdueCount = useMemo(() => {
    if (!pendingTasks.data) return 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return pendingTasks.data.filter((e) => {
      if (!e.due_date) return false;
      const due = new Date(`${e.due_date}T00:00:00`);
      return due.getTime() < now.getTime();
    }).length;
  }, [pendingTasks.data]);

  // External sourced entries for sidebar
  const sourcedEntries = trpc.listEntries.useQuery(
    { source: "any", limit: 10 },
    { refetchInterval: showAiFeed ? false : POLL.sidebarSourced },
  );
  const recentSourced = useMemo(
    () =>
      (sourcedEntries.data ?? [])
        .sort(
          (a, b) => new Date(`${b.created_at}Z`).getTime() - new Date(`${a.created_at}Z`).getTime(),
        )
        .slice(0, 8),
    [sourcedEntries.data],
  );

  const activeIndex = MAIN_TABS.findIndex((t) => t.key === activeTab);

  const handleSwipe = useCallback(() => {
    if (touchEndX.current === -1) return;
    const diffX = touchStartX.current - touchEndX.current;
    const diffY = Math.abs(touchStartY.current - touchEndY.current);
    const threshold = 80;
    // Ignore if vertical movement exceeds horizontal (scrolling, not swiping)
    if (diffY > Math.abs(diffX)) return;
    if (Math.abs(diffX) < threshold) return;
    const diff = diffX;

    // Only swipe between main tabs
    if (activeIndex === -1) return;
    if (diff > 0 && activeIndex < MAIN_TABS.length - 1) {
      setActiveTab(MAIN_TABS[activeIndex + 1].key);
    } else if (diff < 0 && activeIndex > 0) {
      setActiveTab(MAIN_TABS[activeIndex - 1].key);
    }
  }, [activeIndex]);

  if (showGallery) {
    return <Gallery onClose={() => setShowGallery(false)} />;
  }
  if (showAiFeed) {
    return <AiFeed onClose={() => setShowAiFeed(false)} />;
  }

  return (
    <div className="app-layout">
      <div className="container">
        <div className="sticky-top">
          <div className="header">
            <div className="header-title-row">
              {unprocessedCount > 0 ? (
                <button
                  type="button"
                  className="header-unprocessed"
                  onClick={() => setActiveTab(activeTab === "unprocessed" ? "task" : "unprocessed")}
                >
                  {unprocessedCount}
                </button>
              ) : (
                <span className="header-unprocessed-spacer" />
              )}
              <button type="button" className="header-title" onClick={() => setShowGallery(true)}>
                * THE LEDGER *
              </button>
              <span className="header-unprocessed-spacer" />
            </div>
            <div className="header-sub">
              <button
                type="button"
                className={`header-link ${activeTab === "all" ? "active" : ""}`}
                onClick={() => setActiveTab(activeTab === "all" ? "task" : "all")}
              >
                すべて
              </button>
              <button
                type="button"
                className={`header-link ${activeTab === "done" ? "active" : ""}`}
                onClick={() => setActiveTab(activeTab === "done" ? "task" : "done")}
              >
                完了
              </button>
              <button
                type="button"
                className={`header-ai-btn ${hasNewAiResults ? "has-new" : ""}`}
                onClick={() => setShowAiFeed(true)}
                title="AIフィード"
              >
                AI
              </button>
              {recentSourced.length > 0 && (
                <button
                  type="button"
                  className={`header-link header-sourced-btn ${showSourcedModal ? "active" : ""}`}
                  onClick={() => setShowSourcedModal(true)}
                  title="外部入力"
                >
                  外部
                  <span className="header-sourced-count">{recentSourced.length}</span>
                </button>
              )}
              <button
                type="button"
                className="header-link header-gear"
                onClick={() => setShowSettings(true)}
                title="設定"
              >
                {"\u2699"}
              </button>
            </div>
          </div>
          <div className="desktop-input">
            <EntryInput />
          </div>
        </div>

        {overdueCount > 0 && !overdueDismissed && (
          <div className="overdue-banner">
            <span className="overdue-banner-text">
              {overdueCount}件のタスクが期限超過しています
            </span>
            <button
              type="button"
              className="overdue-banner-action"
              onClick={() => setActiveTab("task")}
            >
              確認
            </button>
            <button
              type="button"
              className="overdue-banner-dismiss"
              onClick={() => setOverdueDismissed(true)}
            >
              {"\u2715"}
            </button>
          </div>
        )}

        <div className="section">
          <div className="tabs">
            {MAIN_TABS.map((tab) => (
              <button
                type="button"
                key={tab.key}
                className={`tab ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div
            className="entry-list-box"
            onTouchStart={(e) => {
              touchStartX.current = e.touches[0].clientX;
              touchStartY.current = e.touches[0].clientY;
              touchEndX.current = -1;
            }}
            onTouchMove={(e) => {
              touchEndX.current = e.touches[0].clientX;
              touchEndY.current = e.touches[0].clientY;
            }}
            onTouchEnd={handleSwipe}
          >
            <EntryList tab={activeTab} />
          </div>
        </div>
        {showSettings && <Settings onClose={() => setShowSettings(false)} />}
        <button
          type="button"
          className="fab-add"
          onClick={() => setShowMobileInput(true)}
          aria-label="入力"
        >
          +
        </button>
        {showMobileInput && (
          <div
            className="bottom-sheet-overlay"
            role="dialog"
            onClick={() => setShowMobileInput(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowMobileInput(false);
            }}
          >
            {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation */}
            <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
              <EntryInput onSubmitted={() => setShowMobileInput(false)} />
            </div>
          </div>
        )}
        {showSourcedModal && recentSourced.length > 0 && (
          <div
            className="bottom-sheet-overlay"
            role="dialog"
            onClick={() => setShowSourcedModal(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowSourcedModal(false);
            }}
          >
            {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation */}
            <div className="bottom-sheet sourced-modal" onClick={(e) => e.stopPropagation()}>
              <div className="sourced-modal-header">
                <span className="sourced-modal-title">外部入力</span>
                <button
                  type="button"
                  className="sourced-modal-close"
                  onClick={() => setShowSourcedModal(false)}
                >
                  {"\u2715"}
                </button>
              </div>
              <div className="sourced-modal-list">
                {recentSourced.map((e) => (
                  <div key={e.id} className="sidebar-card">
                    <div className="sidebar-card-header">
                      {e.source && <span className="ai-badge source">{e.source}</span>}
                      <span className="sidebar-card-title">{e.title ?? e.raw_text}</span>
                    </div>
                    {e.result && (
                      <div className="sidebar-card-summary">
                        <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
                          {(e.result.length > 200
                            ? `${e.result.slice(0, 200)}...`
                            : e.result
                          ).replace(/\\n/g, "\n")}
                        </Markdown>
                      </div>
                    )}
                    {e.result_url && (
                      <a
                        href={e.result_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="entry-result-url"
                      >
                        {"\u2197"} URL
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {recentSourced.length > 0 && (
        <aside className="sidebar-sourced">
          <div className="sidebar-title">外部入力</div>
          {recentSourced.map((e) => (
            <div key={e.id} className="sidebar-card">
              <div className="sidebar-card-header">
                {e.source && <span className="ai-badge source">{e.source}</span>}
                <span className="sidebar-card-title">{e.title ?? e.raw_text}</span>
              </div>
              {e.result && (
                <div className="sidebar-card-summary">
                  <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
                    {(e.result.length > 200 ? `${e.result.slice(0, 200)}...` : e.result).replace(
                      /\\n/g,
                      "\n",
                    )}
                  </Markdown>
                </div>
              )}
              {e.result_url && (
                <a
                  href={e.result_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="entry-result-url"
                >
                  {"\u2197"} URL
                </a>
              )}
            </div>
          ))}
        </aside>
      )}
    </div>
  );
}
