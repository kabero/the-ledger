import { MiniCard } from "./MiniCard";
import type { EntryItem } from "./types";

interface CompletedSectionProps {
  entries: EntryItem[];
  completedVisible: number;
  totalCompletedCount: number;
  newResults: number;
  completedHasMore: boolean;
  remainingCompleted: number;
  isLoadingMore: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string, label: string) => void;
  onShowMore: () => void;
  onLoadMore: () => void;
  onMarkAllSeen: () => void;
}

export function CompletedSection({
  entries,
  completedVisible,
  totalCompletedCount,
  newResults,
  completedHasMore,
  remainingCompleted,
  isLoadingMore,
  onSelect,
  onDelete,
  onShowMore,
  onLoadMore,
  onMarkAllSeen,
}: CompletedSectionProps) {
  return (
    <div className="ai-section">
      <div className="ai-section-title">
        <span className="ai-dot done" /> 最近の完了
        {totalCompletedCount > entries.length && (
          <span className="ai-section-count">
            {entries.length} / {totalCompletedCount}件
          </span>
        )}
        {newResults > 0 && (
          <button type="button" className="ai-mark-all-seen" onClick={onMarkAllSeen}>
            すべて既読
          </button>
        )}
      </div>
      {entries.length > 0 && (
        <div className="ai-mini-cards">
          {entries.slice(0, completedVisible).map((e) => (
            <MiniCard
              key={e.id}
              entry={e}
              className={`done ${e.result && !e.result_seen ? "has-new" : ""}`}
              onClick={() => onSelect(e.id)}
              showNew={!!(e.result && !e.result_seen)}
              timeField="completed_at"
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
      {completedVisible < entries.length && (
        <button type="button" className="ai-show-more" onClick={onShowMore}>
          もっと見る ({entries.length - completedVisible}件)
        </button>
      )}
      {completedVisible >= entries.length && completedHasMore && (
        <button
          type="button"
          className="ai-show-more"
          onClick={onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore
            ? "読み込み中..."
            : `もっと読み込む${remainingCompleted > 0 ? ` (残り${remainingCompleted}件)` : ""}`}
        </button>
      )}
    </div>
  );
}
