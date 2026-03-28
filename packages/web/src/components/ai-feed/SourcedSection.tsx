import { MiniCard } from "./MiniCard";
import type { EntryItem } from "./types";

interface SourcedSectionProps {
  entries: EntryItem[];
  onSelect: (id: string) => void;
  onDelete: (id: string, label: string) => void;
}

export function SourcedSection({ entries, onSelect, onDelete }: SourcedSectionProps) {
  if (entries.length === 0) return null;

  return (
    <div className="ai-section">
      <div className="ai-section-title">
        <span className="ai-dot source" /> 外部入力
      </div>
      <div className="ai-mini-cards">
        {entries.map((e) => (
          <MiniCard key={e.id} entry={e} onClick={() => onSelect(e.id)} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}
