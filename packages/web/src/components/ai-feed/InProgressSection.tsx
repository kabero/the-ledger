import { MiniCard } from "./MiniCard";
import type { EntryItem } from "./types";

interface InProgressSectionProps {
  entries: EntryItem[];
  onSelect: (id: string) => void;
  onDelete: (id: string, label: string) => void;
}

export function InProgressSection({ entries, onSelect, onDelete }: InProgressSectionProps) {
  return (
    <div className="ai-section">
      <div className="ai-section-title">
        <span className="ai-dot progress" /> 進行中 ({entries.length})
      </div>
      {entries.length > 0 && (
        <div className="ai-mini-cards">
          {entries.map((e) => (
            <MiniCard
              key={e.id}
              entry={e}
              className={e.urgent ? "urgent" : ""}
              onClick={() => onSelect(e.id)}
              onDelete={onDelete}
              deleteDisabled
            />
          ))}
        </div>
      )}
    </div>
  );
}
