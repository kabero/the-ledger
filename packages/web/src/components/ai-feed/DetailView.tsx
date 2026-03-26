import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EntryItem } from "./types";
import { formatDateTime, normalizeResult } from "./utils";

interface DetailViewProps {
  entry: EntryItem;
  onBack: () => void;
  onClose: () => void;
  onRetry: (id: string) => void;
}

export function DetailView({ entry, onBack, onClose, onRetry }: DetailViewProps) {
  return (
    <div className="ai-feed">
      <div className="ai-feed-header">
        <button type="button" className="ai-detail-back" onClick={onBack}>
          {"<"} 戻る
        </button>
        <button type="button" className="gallery-close" aria-label="閉じる" onClick={onClose}>
          x
        </button>
      </div>
      <div className="ai-detail">
        <div className="ai-detail-meta">
          {entry.source && <span className="ai-badge source">{entry.source}</span>}
          <span className="ai-badge type">{entry.type}</span>
          {entry.status === "done" && <span className="ai-badge done">{"\u2713"}</span>}
        </div>
        <h2 className="ai-detail-title">{entry.title ?? entry.raw_text}</h2>
        <div className="ai-detail-timestamps">
          <span>作成: {formatDateTime(entry.created_at)}</span>
          {entry.completed_at && <span>完了: {formatDateTime(entry.completed_at)}</span>}
        </div>
        {entry.tags.length > 0 && (
          <div className="ai-card-tags">
            {entry.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
        {entry.result_url && (
          <a
            href={entry.result_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ai-result-url"
          >
            {"\u2197"} {entry.result_url}
          </a>
        )}
        {entry.result ? (
          <>
            <div className="ai-detail-result">
              <Markdown remarkPlugins={[remarkGfm]}>{normalizeResult(entry.result)}</Markdown>
            </div>
            {entry.status === "done" && entry.delegatable && (
              <button
                type="button"
                className="ai-action-btn retry"
                onClick={() => onRetry(entry.id)}
              >
                {"\u21BA"} もう一回やらせる
              </button>
            )}
          </>
        ) : entry.raw_text && entry.raw_text !== entry.title ? (
          <div className="ai-detail-result">
            <Markdown remarkPlugins={[remarkGfm]}>{normalizeResult(entry.raw_text)}</Markdown>
          </div>
        ) : (
          <div className="ai-detail-empty">
            {entry.status === "done" ? "結果なし" : "作業待ち..."}
          </div>
        )}
      </div>
    </div>
  );
}
