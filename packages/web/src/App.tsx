import { useCallback, useEffect, useMemo, useState } from "react";
import { AiFeed } from "./components/AiFeed";
import { EntryInput } from "./components/EntryInput";
import { EntryList } from "./components/EntryList";
import { FocusMode } from "./components/FocusMode";
import { Gallery } from "./components/Gallery";
import { ModalOverlay } from "./components/ModalOverlay";
import { applyFont, applyTheme, Settings } from "./components/Settings";
import { SourcedList } from "./components/SourcedList";
import { useOverdueDetection } from "./hooks/useOverdueDetection";
import { useSwipe } from "./hooks/useSwipe";
import { POLL } from "./poll";
import { trpc } from "./trpc";
import { MAIN_TABS, type Tab } from "./types";

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("task");
  const [showGallery, setShowGallery] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAiFeed, setShowAiFeed] = useState(() => window.location.pathname === "/ai");
  const [showMobileInput, setShowMobileInput] = useState(false);
  const [showSourcedModal, setShowSourcedModal] = useState(false);
  const [showFocusMode, setShowFocusMode] = useState(false);

  useEffect(() => {
    applyFont();
    applyTheme();
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape: close topmost modal/view
      if (e.key === "Escape") {
        if (showSourcedModal) {
          setShowSourcedModal(false);
          e.preventDefault();
        } else if (showSettings) {
          setShowSettings(false);
          e.preventDefault();
        } else if (showMobileInput) {
          setShowMobileInput(false);
          e.preventDefault();
        } else if (showGallery) {
          setShowGallery(false);
          e.preventDefault();
        } else if (showAiFeed) {
          setShowAiFeed(false);
          e.preventDefault();
        } else if (showFocusMode) {
          setShowFocusMode(false);
          e.preventDefault();
        }
      }
      // Cmd+Shift+K or Ctrl+Shift+K: focus the search/input textarea
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "K") {
        e.preventDefault();
        const textarea = document.querySelector<HTMLTextAreaElement>(".input-box");
        if (textarea) {
          textarea.focus();
          textarea.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showSourcedModal, showSettings, showMobileInput, showGallery, showAiFeed, showFocusMode]);

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
  const newAiResultCount = useMemo(
    () => (aiTasks.data ?? []).filter((e) => e.result && !e.result_seen).length,
    [aiTasks.data],
  );
  const hasNewAiResults = newAiResultCount > 0;

  const utils = trpc.useUtils();
  const markAllSeen = trpc.markAllResultsSeen.useMutation({
    onSuccess: () => utils.listEntries.invalidate(),
  });

  // Overdue task detection
  const { overdueCount, overdueDismissed, handleOverdueDismiss } = useOverdueDetection(showAiFeed);

  // External sourced entries for sidebar
  const sourcedEntries = trpc.listEntries.useQuery(
    { source: "any", limit: 20 },
    { refetchInterval: showAiFeed ? false : POLL.sidebarSourced },
  );
  const { recentSourced, recentSummaries } = useMemo(() => {
    const sorted = (sourcedEntries.data ?? []).sort(
      (a, b) => new Date(`${b.created_at}Z`).getTime() - new Date(`${a.created_at}Z`).getTime(),
    );
    const summaries: typeof sorted = [];
    const others: typeof sorted = [];
    for (const e of sorted) {
      if (e.source === "analyst" || e.source === "auto-summary") {
        summaries.push(e);
      } else {
        others.push(e);
      }
    }
    return {
      recentSourced: others.slice(0, 8),
      recentSummaries: summaries.slice(0, 8),
    };
  }, [sourcedEntries.data]);

  const activeIndex = MAIN_TABS.findIndex((t) => t.key === activeTab);

  const swipeHandlers = useSwipe({
    onSwipeLeft: useCallback(() => {
      if (activeIndex >= 0 && activeIndex < MAIN_TABS.length - 1) {
        setActiveTab(MAIN_TABS[activeIndex + 1].key);
      }
    }, [activeIndex]),
    onSwipeRight: useCallback(() => {
      if (activeIndex > 0) {
        setActiveTab(MAIN_TABS[activeIndex - 1].key);
      }
    }, [activeIndex]),
  });

  if (showFocusMode) {
    return <FocusMode onClose={() => setShowFocusMode(false)} />;
  }
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
                aria-pressed={activeTab === "all"}
                aria-label="すべて表示"
              >
                すべて
              </button>
              <button
                type="button"
                className={`header-link ${activeTab === "done" ? "active" : ""}`}
                onClick={() => setActiveTab(activeTab === "done" ? "task" : "done")}
                aria-pressed={activeTab === "done"}
                aria-label="完了済み表示"
              >
                完了
              </button>
              <span className="header-ai-group">
                <button
                  type="button"
                  className={`header-ai-btn ${hasNewAiResults ? "has-new" : ""}`}
                  onClick={() => setShowAiFeed(true)}
                  title="AIフィード"
                  aria-label="AIフィードを開く"
                >
                  AI
                  {newAiResultCount > 0 && (
                    <span className="header-ai-count">{newAiResultCount}</span>
                  )}
                </button>
                {hasNewAiResults && (
                  <button
                    type="button"
                    className="header-mark-seen"
                    onClick={() => markAllSeen.mutate()}
                    title="すべて既読にする"
                  >
                    {"\u2713"}
                  </button>
                )}
              </span>
              {(recentSourced.length > 0 || recentSummaries.length > 0) && (
                <button
                  type="button"
                  className={`header-link header-sourced-btn ${showSourcedModal ? "active" : ""}`}
                  onClick={() => setShowSourcedModal(true)}
                  title="外部入力・サマリ"
                  aria-pressed={showSourcedModal}
                  aria-label="外部入力・サマリを表示"
                >
                  外部
                  <span className="header-sourced-count">
                    {recentSourced.length + recentSummaries.length}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="header-link header-focus-btn"
                onClick={() => setShowFocusMode(true)}
                title="フォーカスモード"
                aria-label="フォーカスモードを開く"
              >
                {"\u25CE"}
              </button>
              <button
                type="button"
                className="header-link header-gear"
                onClick={() => setShowSettings(true)}
                title="設定"
                aria-label="設定を開く"
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
            <button type="button" className="overdue-banner-dismiss" onClick={handleOverdueDismiss}>
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
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`tab ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                {tab.key === "llm" && newAiResultCount > 0 && (
                  <span className="tab-new-count">{newAiResultCount}</span>
                )}
                {tab.key === "task" && overdueCount > 0 && (
                  <span className="tab-overdue-count">{overdueCount}</span>
                )}
              </button>
            ))}
          </div>
          {activeIndex >= 0 && (
            <div className="swipe-dots">
              {MAIN_TABS.map((tab, i) => (
                <span key={tab.key} className={`swipe-dot ${i === activeIndex ? "active" : ""}`} />
              ))}
            </div>
          )}
          {(activeTab === "all" || activeTab === "done") && (
            <div className="view-banner">
              <span className="view-banner-label">
                {activeTab === "all" ? "すべて" : "完了済み"}
              </span>
              <button
                type="button"
                className="view-banner-back"
                onClick={() => setActiveTab("task")}
              >
                {"\u2190"} タスクに戻る
              </button>
            </div>
          )}
          {activeTab === "llm" && hasNewAiResults && (
            <div className="tab-action-bar">
              <button
                type="button"
                className="tab-mark-all-seen"
                onClick={() => markAllSeen.mutate()}
              >
                {"\u2713"} すべて既読
              </button>
            </div>
          )}
          <div
            className="entry-list-box"
            onTouchStart={swipeHandlers.onTouchStart}
            onTouchMove={swipeHandlers.onTouchMove}
            onTouchEnd={swipeHandlers.onTouchEnd}
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
          <ModalOverlay
            className="bottom-sheet-overlay"
            ariaLabel="入力"
            onClose={() => setShowMobileInput(false)}
          >
            <div className="bottom-sheet">
              <EntryInput onSubmitted={() => setShowMobileInput(false)} />
            </div>
          </ModalOverlay>
        )}
        {showSourcedModal && (recentSourced.length > 0 || recentSummaries.length > 0) && (
          <ModalOverlay
            className="bottom-sheet-overlay"
            ariaLabel="外部入力・サマリ"
            onClose={() => setShowSourcedModal(false)}
          >
            <div className="bottom-sheet sourced-modal">
              <div className="sourced-modal-header">
                <span className="sourced-modal-title">外部入力・サマリ</span>
                <button
                  type="button"
                  className="sourced-modal-close"
                  onClick={() => setShowSourcedModal(false)}
                >
                  {"\u2715"}
                </button>
              </div>
              <div className="sourced-modal-list">
                <SourcedList summaries={recentSummaries} sourced={recentSourced} variant="modal" />
              </div>
            </div>
          </ModalOverlay>
        )}
      </div>
      {(recentSummaries.length > 0 || recentSourced.length > 0) && (
        <aside className="sidebar-sourced">
          <SourcedList summaries={recentSummaries} sourced={recentSourced} variant="sidebar" />
        </aside>
      )}
    </div>
  );
}
