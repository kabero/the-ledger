import { useCallback, useRef, useState } from "react";
import { EntryInput } from "./components/EntryInput";
import { EntryList } from "./components/EntryList";
import { GraphView } from "./components/GraphView";
import { trpc } from "./trpc";

type Tab = "all" | "task" | "note" | "wish" | "done" | "unprocessed" | "llm";

const MAIN_TABS: { key: Tab; label: string }[] = [
  { key: "task", label: "タスク" },
  { key: "note", label: "メモ" },
  { key: "wish", label: "ほしい" },
  { key: "llm", label: "LLM" },
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("task");
  const [showGraph, setShowGraph] = useState(false);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const unprocessed = trpc.getUnprocessed.useQuery({ limit: 50 }, { refetchInterval: 10_000 });
  const unprocessedCount = unprocessed.data?.length ?? 0;

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

  if (showGraph) {
    return (
      <div className="graph-fullscreen">
        <button type="button" className="graph-close" onClick={() => setShowGraph(false)}>
          x
        </button>
        <GraphView fullscreen />
      </div>
    );
  }

  return (
    <div className="container">
      <div className="sticky-top">
        <div className="header">
          <button type="button" className="header-title" onClick={() => setShowGraph(true)}>
            * THE LEDGER *
          </button>
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
            {unprocessedCount > 0 && (
              <button
                type="button"
                className="badge"
                onClick={() =>
                  setActiveTab(activeTab === "unprocessed" ? "task" : "unprocessed")
                }
                style={{ cursor: "pointer", border: "none" }}
              >
                {unprocessedCount} 件 未処理
              </button>
            )}
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
        {/* biome-ignore lint/a11y/noStaticElementInteractions: swipe area */}
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
    </div>
  );
}
