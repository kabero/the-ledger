import type { EntryItem } from "./types";
import { formatTime } from "./utils";

interface PendingDecisionsSectionProps {
  entries: EntryItem[];
  expandedId: string | null;
  decisionSelected: Record<string, number | null>;
  decisionComment: Record<string, string>;
  onExpand: (id: string | null) => void;
  onSelect: (id: string, idx: number | null) => void;
  onCommentChange: (id: string, value: string) => void;
  onSubmit: (entry: EntryItem, selected: number | null, comment: string | null) => void;
  onConvertToHuman: (entry: EntryItem) => void;
  onDelete: (id: string, label: string) => void;
  onOpenDetail: (id: string) => void;
  onInlineDecide: (entry: EntryItem, idx: number) => void;
}

export function PendingDecisionsSection({
  entries,
  expandedId,
  decisionSelected,
  decisionComment,
  onExpand,
  onSelect,
  onCommentChange,
  onSubmit,
  onConvertToHuman,
  onDelete,
  onOpenDetail,
  onInlineDecide,
}: PendingDecisionsSectionProps) {
  if (entries.length === 0) return null;

  return (
    <div className="ai-section">
      <div className="ai-section-title">
        <span className="ai-dot decision" /> 判断待ち ({entries.length})
      </div>
      <div className="ai-decision-cards">
        {entries.map((e) => {
          const hasOptions = e.decision_options && e.decision_options.length > 0;
          const selected = decisionSelected[e.id] ?? null;
          const isExpanded = expandedId === e.id;
          const isBinary = hasOptions && e.decision_options && e.decision_options.length === 2;
          return (
            <div key={e.id} className={`ai-decision-card ${isExpanded ? "expanded" : "compact"}`}>
              <button
                type="button"
                className="ai-decision-compact-row"
                onClick={() => onExpand(isExpanded ? null : e.id)}
              >
                <span className="ai-decision-compact-title">{e.title ?? e.raw_text}</span>
                {e.tags.length > 0 && (
                  <span className="ai-decision-compact-tags">
                    {e.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
                <span className="ai-mini-time">{formatTime(e.created_at)}</span>
                <span className="ai-decision-chevron">{isExpanded ? "\u25B2" : "\u25BC"}</span>
              </button>
              {/* One-click inline buttons for binary decisions */}
              {isBinary && !isExpanded && (
                <div className="ai-decision-inline-actions">
                  {(e.decision_options ?? []).map((opt, idx) => (
                    <button
                      key={opt}
                      type="button"
                      className="ai-decision-inline-btn"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onInlineDecide(e, idx);
                      }}
                      title={opt}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="ai-action trash ai-decision-delete"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onDelete(e.id, e.title ?? e.raw_text);
                }}
                title="削除"
              >
                {"\u2715"}
              </button>
              {isExpanded && (
                <div className="ai-decision-expanded">
                  <button
                    type="button"
                    className="ai-decision-detail-link"
                    onMouseDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpenDetail(e.id);
                    }}
                  >
                    詳細を見る
                  </button>
                  {hasOptions && (
                    <div className="ai-decision-options">
                      {(e.decision_options ?? []).map((opt, idx) => (
                        <button
                          key={opt}
                          type="button"
                          className={`ai-decision-opt ${selected === idx ? "selected" : ""}`}
                          onMouseDown={(ev) => ev.stopPropagation()}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onSelect(e.id, decisionSelected[e.id] === idx ? null : idx);
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    className="ai-decision-comment"
                    placeholder="コメント（任意）"
                    aria-label="判断コメント"
                    value={decisionComment[e.id] ?? ""}
                    onMouseDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={(ev) => onCommentChange(e.id, ev.target.value)}
                  />
                  <div className="ai-decision-footer">
                    <button
                      type="button"
                      className="ai-decision-delegate-btn"
                      onMouseDown={(ev) => ev.stopPropagation()}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onSubmit(e, selected, decisionComment[e.id] || null);
                      }}
                    >
                      {hasOptions && selected != null
                        ? `「${(e.decision_options ?? [])[selected]}」で決定して委譲`
                        : "決定して委譲"}
                    </button>
                    <button
                      type="button"
                      className="ai-decision-delegate-btn"
                      onMouseDown={(ev) => ev.stopPropagation()}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onConvertToHuman(e);
                      }}
                    >
                      人間タスクに変更
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
