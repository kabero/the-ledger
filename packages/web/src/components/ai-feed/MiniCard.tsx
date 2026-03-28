import { memo, useCallback, useMemo, useState } from "react";
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
  onDelete?: (id: string, label: string) => void;
  deleteDisabled?: boolean;
}

export const MiniCard = memo(function MiniCard({
  entry,
  className = "",
  onClick,
  showNew = false,
  showImplementing = false,
  timeField = "created_at",
  onDelete,
  deleteDisabled = false,
}: MiniCardProps) {
  const time = timeField === "completed_at" ? entry.completed_at : entry.created_at;
  const isImageOnly = !!(entry.image_path && entry.raw_text === "(画像)");
  const hoverContent =
    entry.result ?? (entry.raw_text !== entry.title && !isImageOnly ? entry.raw_text : null);
  const hasTooltip = !!(hoverContent || entry.image_path);

  // Defer hover modal rendering until first hover to reduce DOM count
  const [hovered, setHovered] = useState(false);
  const handleMouseEnter = useCallback(() => setHovered(true), []);

  const tooltipMarkdown = useMemo(
    () =>
      hovered && hoverContent ? (
        <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
          {normalizeResult(hoverContent)}
        </Markdown>
      ) : null,
    [hovered, hoverContent],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover tooltip wrapper, no keyboard interaction needed
    <div
      className={`ai-mini-wrap ${hasTooltip ? "has-tooltip" : ""}`}
      onMouseEnter={hasTooltip ? handleMouseEnter : undefined}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: div[role=button] needed to allow nested buttons */}
      <div
        role="button"
        tabIndex={0}
        className={`ai-mini ${className} ${entry.result_url ? "has-link" : ""}`}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onClick();
        }}
      >
        <div className="ai-mini-top">
          <div className="ai-mini-title">
            {entry.title ??
              (isImageOnly ? (
                <img
                  className="ai-mini-thumb"
                  src={`/images/${entry.image_path?.split("/").pop()}`}
                  alt="画像"
                  loading="lazy"
                />
              ) : (
                entry.raw_text
              ))}
          </div>
          {showImplementing && <span className="ai-badge implementing">実装中</span>}
          {showNew && <span className="ai-badge new">NEW</span>}
          {onDelete && (
            <button
              type="button"
              className={`ai-mini-delete ${deleteDisabled ? "disabled" : ""}`}
              disabled={deleteDisabled}
              title={deleteDisabled ? "進行中は削除できません" : "削除"}
              onClick={(e) => {
                e.stopPropagation();
                if (!deleteDisabled) onDelete(entry.id, entry.title ?? entry.raw_text);
              }}
            >
              {"\u00d7"}
            </button>
          )}
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
      </div>
      {hasTooltip && hovered && (
        <div className="ai-hover-modal">
          {entry.image_path && (
            <img
              className="ai-hover-thumb"
              src={`/images/${entry.image_path.split("/").pop()}`}
              alt={entry.title ?? "添付画像"}
              loading="lazy"
            />
          )}
          {tooltipMarkdown}
        </div>
      )}
    </div>
  );
});
