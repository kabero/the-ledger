import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { useClipboard } from "../../hooks/useClipboard";
import { remarkPlugins, safeUrlTransform } from "../../markdown";
import { trpc } from "../../trpc";
import type { EntryItem } from "./types";
import { formatDateTime, normalizeResult } from "./utils";

interface DetailViewProps {
  entry: EntryItem;
  onBack: () => void;
  onClose: () => void;
  onRetry: (id: string) => void;
}

export function DetailView({ entry, onBack, onClose, onRetry }: DetailViewProps) {
  const utils = trpc.useUtils();
  const updateEntry = trpc.updateEntry.useMutation({
    onSuccess: () => utils.listEntries.invalidate(),
  });
  const [copied, copy] = useClipboard();
  const [selectedOpt, setSelectedOpt] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const needsDecision =
    !entry.delegatable &&
    entry.status !== "done" &&
    entry.type !== "trash" &&
    (entry.type === "task" ||
      entry.type === "wish" ||
      (entry.decision_options && entry.decision_options.length > 0));

  const resultMarkdown = useMemo(
    () =>
      entry.result ? (
        <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
          {normalizeResult(entry.result)}
        </Markdown>
      ) : null,
    [entry.result],
  );

  const rawTextMarkdown = useMemo(
    () =>
      !entry.result && entry.raw_text && entry.raw_text !== entry.title ? (
        <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
          {normalizeResult(entry.raw_text)}
        </Markdown>
      ) : null,
    [entry.result, entry.raw_text, entry.title],
  );

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
          {entry.delegatable && entry.status !== "done" && (
            <span className="ai-badge implementing">実装中</span>
          )}
          {needsDecision && <span className="ai-badge decision">判断待ち</span>}
          {entry.urgent && <span className="ai-badge urgent">!</span>}
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
        {/* Action buttons row */}
        <div className="ai-detail-actions">
          <button
            type="button"
            className={`ai-action-btn ${entry.urgent ? "urgent-active" : ""}`}
            onClick={() => updateEntry.mutate({ id: entry.id, urgent: !entry.urgent })}
            title={entry.urgent ? "優先フラグを外す" : "優先フラグを付ける"}
          >
            {entry.urgent ? "! 優先" : "優先フラグ"}
          </button>
          {entry.result && (
            <button
              type="button"
              className={`ai-action-btn ${copied ? "copied" : ""}`}
              onClick={() => entry.result && copy(entry.result)}
            >
              {copied ? "\u2713 copied" : "copy"}
            </button>
          )}
        </div>
        {entry.result_url && (
          <button
            type="button"
            className="ai-result-url"
            onClick={() =>
              window.open(entry.result_url as string, "_blank", "noopener,noreferrer,popup")
            }
          >
            {"\u2197"} {entry.result_url}
          </button>
        )}
        {/* Decision info if already decided */}
        {entry.decision_options && entry.decision_selected != null && (
          <div className="ai-detail-decision">
            <div className="ai-detail-decision-label">選択済み:</div>
            <div className="ai-detail-decision-value">
              {entry.decision_options[entry.decision_selected]}
            </div>
            {entry.decision_comment && (
              <div className="ai-detail-decision-comment">コメント: {entry.decision_comment}</div>
            )}
          </div>
        )}
        {/* Decision panel for entries awaiting judgment */}
        {needsDecision && (
          <div className="ai-detail-decision-panel">
            <div className="ai-detail-decision-panel-title">方針を決定してください</div>
            {entry.decision_options && entry.decision_options.length > 0 && (
              <div className="ai-decision-options">
                {entry.decision_options.map((opt, idx) => (
                  <button
                    key={opt}
                    type="button"
                    className={`ai-decision-opt ${selectedOpt === idx ? "selected" : ""}`}
                    onClick={() => setSelectedOpt(selectedOpt === idx ? null : idx)}
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
              value={comment}
              onChange={(ev) => setComment(ev.target.value)}
            />
            <button
              type="button"
              className="ai-decision-delegate-btn"
              onClick={() => {
                updateEntry.mutate({
                  id: entry.id,
                  delegatable: true,
                  decision_selected: selectedOpt,
                  decision_comment: comment || null,
                });
                onBack();
              }}
            >
              {entry.decision_options && selectedOpt != null
                ? `「${entry.decision_options[selectedOpt]}」で決定して委譲`
                : "決定して委譲"}
            </button>
          </div>
        )}
        {resultMarkdown ? (
          <>
            <div className="ai-detail-result">{resultMarkdown}</div>
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
        ) : rawTextMarkdown ? (
          <div className="ai-detail-result">{rawTextMarkdown}</div>
        ) : (
          <div className="ai-detail-empty">
            {entry.status === "done" ? "結果なし" : "作業待ち..."}
          </div>
        )}
      </div>
    </div>
  );
}
