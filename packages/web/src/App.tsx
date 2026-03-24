import { useCallback, useRef, useState } from "react";
import { EntryInput } from "./components/EntryInput";
import { EntryList } from "./components/EntryList";
import { trpc } from "./trpc";

type Tab = "all" | "task" | "event" | "note" | "wish" | "done";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "task", label: "タスク" },
  { key: "event", label: "予定" },
  { key: "note", label: "メモ" },
  { key: "wish", label: "ほしい" },
  { key: "done", label: "完了" },
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const unprocessed = trpc.getUnprocessed.useQuery({ limit: 50 }, { refetchInterval: 10_000 });
  const unprocessedCount = unprocessed.data?.length ?? 0;

  const activeIndex = TABS.findIndex((t) => t.key === activeTab);

  const handleSwipe = useCallback(() => {
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;
    if (Math.abs(diff) < threshold) return;

    if (diff > 0 && activeIndex < TABS.length - 1) {
      setActiveTab(TABS[activeIndex + 1].key);
    } else if (diff < 0 && activeIndex > 0) {
      setActiveTab(TABS[activeIndex - 1].key);
    }
  }, [activeIndex]);

  return (
    <div className="container">
      <div className="sticky-top">
        <div className="header">
          * THE LEDGER *
          {unprocessedCount > 0 && (
            <span style={{ marginLeft: 12 }}>
              <span className="badge">{unprocessedCount} 件 未処理</span>
            </span>
          )}
        </div>
        <EntryInput />
      </div>

      <div className="section">
        <div className="tabs">
          {TABS.map((tab) => (
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
