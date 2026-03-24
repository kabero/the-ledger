import { useState } from "react";
import { EntryInput } from "./components/EntryInput";
import { EntryList } from "./components/EntryList";
import { trpc } from "./trpc";

type Tab = "all" | "task" | "event" | "note" | "wish" | "done";

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("all");

  const unprocessed = trpc.getUnprocessed.useQuery({ limit: 50 }, { refetchInterval: 10_000 });
  const unprocessedCount = unprocessed.data?.length ?? 0;

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "すべて" },
    { key: "task", label: "タスク" },
    { key: "event", label: "予定" },
    { key: "note", label: "メモ" },
    { key: "wish", label: "ほしい" },
    { key: "done", label: "完了" },
  ];

  return (
    <div className="container">
      <div className="header">
        * THE LEDGER *
        {unprocessedCount > 0 && (
          <span style={{ marginLeft: 12 }}>
            <span className="badge">{unprocessedCount} 件 未処理</span>
          </span>
        )}
      </div>

      <div className="section">
        <EntryInput />
      </div>

      <div className="section">
        <div className="tabs">
          {tabs.map((tab) => (
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
        <div className="entry-list-box">
          <EntryList tab={activeTab} />
        </div>
      </div>
    </div>
  );
}
