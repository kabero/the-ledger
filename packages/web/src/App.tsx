import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiFeed } from "./components/AiFeed";
import { EntryInput } from "./components/EntryInput";
import { EntryList } from "./components/EntryList";
import { Gallery } from "./components/Gallery";
import { applyFont, Settings } from "./components/Settings";
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

  useEffect(() => {
    applyFont();
  }, []);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  // Disable polling when AiFeed is open (it has its own queries)
  const unprocessed = trpc.getUnprocessed.useQuery(
    { limit: 50 },
    { refetchInterval: showAiFeed ? false : 10_000 },
  );
  const unprocessedCount = unprocessed.data?.length ?? 0;

  // Check for unseen AI results
  const aiTasks = trpc.listEntries.useQuery(
    { delegatable: true, limit: 100 },
    { refetchInterval: showAiFeed ? false : 10_000 },
  );
  const hasNewAiResults = useMemo(
    () => (aiTasks.data ?? []).some((e) => e.result && !e.result_seen),
    [aiTasks.data],
  );

  const activeIndex = MAIN_TABS.findIndex((t) => t.key === activeTab);

  const handleSwipe = useCallback(() => {
    if (touchEndX.current === -1) return;
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 80;
    if (Math.abs(diff) < threshold) return;

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
        <EntryInput />
      </div>

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
            touchEndX.current = -1;
          }}
          onTouchMove={(e) => {
            touchEndX.current = e.touches[0].clientX;
          }}
          onTouchEnd={handleSwipe}
        >
          <EntryList tab={activeTab} />
        </div>
      </div>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
