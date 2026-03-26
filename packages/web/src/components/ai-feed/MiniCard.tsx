import { memo, useMemo } from "react";
import Markdown from "react-markdown";
import { remarkPlugins, safeUrlTransform } from "../../markdown";
import type { EntryItem } from "./types";
import { formatTime, normalizeResult } from "./utils";

interface MiniCardProps {
  entry: EntryItem;
  className?: string;
  onClick: () => void;
  showNew?: boolean;
  showImplementing?: boolean;
  timeField?: "created_at" | "completed_at";
}

export const MiniCard = memo(function MiniCard({
  entry,
  className = "",
  onClick,
  showNew = false,
  showImplementing = false,
  timeField = "created_at",
}: MiniCardProps) {
  const time = timeField === "completed_at" ? entry.completed_at : entry.created_at;
  const hoverContent = entry.result ?? (entry.raw_text !== entry.title ? entry.raw_text : null);

  const tooltipMarkdown = useMemo(
    () =>
      hoverContent ? (
        <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
          {normalizeResult(hoverContent)}
        </Markdown>
      ) : null,
    [hoverContent],
  );

  return (
    <div className={`ai-mini-wrap ${hoverContent ? "has-tooltip" : ""}`}>
      <button
        type="button"
        className={`ai-mini ${className} ${entry.result_url ? "has-link" : ""}`}
        onClick={onClick}
      >
        <div className="ai-mini-top">
          <div className="ai-mini-title">{entry.title ?? entry.raw_text}</div>
          {showImplementing && <span className="ai-badge implementing">実装中</span>}
          {showNew && <span className="ai-badge new">NEW</span>}
        </div>
        <div className="ai-mini-meta">
          {entry.source && <span className="ai-badge source">{entry.source}</span>}
          {entry.urgent && <span className="ai-badge urgent">!</span>}
          {entry.result_url && (
            <button
              type="button"
              className="ai-badge link"
              title={entry.result_url}
              onClick={(e) => {
                e.stopPropagation();
                window.open(entry.result_url as string, "_blank", "noopener,noreferrer,popup");
              }}
            >
              {"\u2197"}
            </button>
          )}
          {time && <span className="ai-mini-time">{formatTime(time)}</span>}
        </div>
      </button>
      {tooltipMarkdown && <div className="ai-hover-modal">{tooltipMarkdown}</div>}
    </div>
  );
});
