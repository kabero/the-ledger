import { MiniCard } from "./MiniCard";
import type { EntryItem } from "./types";

interface HumanTasksSectionProps {
  entries: EntryItem[];
  showAll: boolean;
  onSelect: (id: string) => void;
  onToggleShowAll: () => void;
  onMarkDone: (id: string) => void;
  onDelegate: (id: string) => void;
  onDelete: (id: string, label: string) => void;
}

export function HumanTasksSection({
  entries,
  showAll,
  onSelect,
  onToggleShowAll,
  onMarkDone,
  onDelegate,
  onDelete,
}: HumanTasksSectionProps) {
  if (entries.length === 0) return null;

  return (
    <div className="ai-section">
      <div className="ai-section-title">
        <span className="ai-dot human" /> 人間タスク ({entries.length})
      </div>
      <div className="ai-mini-cards">
        {(showAll ? entries : entries.slice(0, 6)).map((e) => (
          <div key={e.id} className="ai-human-card-wrap">
            <MiniCard
              entry={e}
              className={`human ${e.urgent ? "urgent" : ""}`}
              onClick={() => onSelect(e.id)}
              onDelete={onDelete}
            />
            <div className="ai-human-actions">
              <button
                type="button"
                className="ai-action done"
                onClick={() => onMarkDone(e.id)}
                title="完了"
              >
                {"\u2713"}
              </button>
              <button
                type="button"
                className="ai-action delegate"
                onClick={() => onDelegate(e.id)}
                title="AIに任せる"
              >
                AI
              </button>
              <button
                type="button"
                className="ai-action trash"
                onClick={() => onDelete(e.id, e.title ?? e.raw_text)}
                title="削除"
              >
                {"\u2715"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {entries.length > 6 && (
        <button type="button" className="ai-show-more" onClick={onToggleShowAll}>
          {showAll ? "閉じる" : `もっと見る (${entries.length - 6}件)`}
        </button>
      )}
    </div>
  );
}
