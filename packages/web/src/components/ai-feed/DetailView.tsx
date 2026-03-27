import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { useClipboard } from "../../hooks/useClipboard";
import { remarkPlugins, safeUrlTransform } from "../../markdown";
import { trpc } from "../../trpc";
import type { EntryItem } from "./types";
import { formatDateTime, normalizeResult } from "./utils";

const DETAIL_WIDTH_KEY = "detail-panel-width";
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
const MAX_WIDTH_RATIO = 0.8;

function useResizableWidth() {
  const [width, setWidth] = useState<number>(() => {
    const stored = localStorage.getItem(DETAIL_WIDTH_KEY);
    return stored ? Math.max(MIN_WIDTH, Number(stored)) : DEFAULT_WIDTH;
  });
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const parent = e.currentTarget.parentElement;
    const startWidth = parent ? parseInt(getComputedStyle(parent).width, 10) : MIN_WIDTH;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX - ev.clientX;
      const maxW = window.innerWidth * MAX_WIDTH_RATIO;
      const newWidth = Math.min(maxW, Math.max(MIN_WIDTH, startWidth + delta));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  useEffect(() => {
    localStorage.setItem(DETAIL_WIDTH_KEY, String(Math.round(width)));
  }, [width]);

  return { width, onMouseDown };
}

interface DetailViewProps {
  entry: EntryItem;
  onBack: () => void;
  onClose: () => void;
}

export function DetailView({ entry, onBack, onClose }: DetailViewProps) {
  const { width, onMouseDown } = useResizableWidth();
  const utils = trpc.useUtils();
  const invalidateAll = () => {
    utils.listEntries.invalidate();
    utils.listEntriesWithCursor.invalidate();
    utils.countEntries.invalidate();
  };
  const updateEntry = trpc.updateEntry.useMutation({ onSuccess: invalidateAll });
  const reopenTask = trpc.reopenTask.useMutation({
    onSuccess: () => {
      invalidateAll();
      onBack();
    },
  });
  const [copied, copy] = useClipboard();
  const [selectedOpt, setSelectedOpt] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [showReopenForm, setShowReopenForm] = useState(false);
  const [reopenFeedback, setReopenFeedback] = useState("");
  const reopenInputRef = useRef<HTMLTextAreaElement>(null);
  const needsDecision =
    entry.decision_options &&
    entry.decision_options.length > 0 &&
    entry.decision_selected == null &&
    !entry.decision_comment &&
    entry.status !== "done";

  const isImageOnly = !!(entry.image_path && entry.raw_text === "(画像)");

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
      !entry.result && entry.raw_text && entry.raw_text !== entry.title && !isImageOnly ? (
        <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
          {normalizeResult(entry.raw_text)}
        </Markdown>
      ) : null,
    [entry.result, entry.raw_text, entry.title, isImageOnly],
  );

  return (
    <div className="ai-detail-panel" style={{ "--detail-w": `${width}px` } as React.CSSProperties}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: resize handle */}
      <div className="ai-detail-resize-handle" onMouseDown={onMouseDown} />
      <div className="ai-detail-panel-header">
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
        {(entry.title || !isImageOnly) && (
          <h2 className="ai-detail-title">{entry.title ?? entry.raw_text}</h2>
        )}
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
                  ...(selectedOpt != null ? { decision_selected: selectedOpt } : {}),
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
        {entry.image_path && (
          <div className="ai-detail-image">
            <img
              src={`/images/${entry.image_path.split("/").pop()}`}
              alt={entry.title ?? "添付画像"}
              loading="lazy"
            />
          </div>
        )}
        {resultMarkdown ? (
          <>
            <div className="ai-detail-result">{resultMarkdown}</div>
            {entry.status === "done" &&
              entry.delegatable &&
              (showReopenForm ? (
                <div
                  style={{
                    padding: "10px 12px",
                    background: "var(--bg-card, #0a0a0a)",
                    border: "1px solid var(--border-subtle, #222)",
                    borderRadius: 6,
                    marginTop: 8,
                  }}
                >
                  <textarea
                    ref={reopenInputRef}
                    value={reopenFeedback}
                    onChange={(e) => setReopenFeedback(e.target.value)}
                    placeholder="追加指示（任意）"
                    rows={3}
                    style={{
                      width: "100%",
                      background: "var(--bg, #000)",
                      color: "var(--fg, #eee)",
                      border: "1px solid var(--border-subtle, #333)",
                      borderRadius: 4,
                      padding: "6px 8px",
                      fontSize: 13,
                      fontFamily: "var(--font)",
                      resize: "vertical",
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        reopenTask.mutate({
                          id: entry.id,
                          feedback: reopenFeedback.trim() || undefined,
                        });
                      }
                      if (e.key === "Escape") {
                        setShowReopenForm(false);
                        setReopenFeedback("");
                      }
                    }}
                  />
                  <div
                    style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}
                  >
                    <button
                      type="button"
                      className="ai-action-btn"
                      onClick={() => {
                        setShowReopenForm(false);
                        setReopenFeedback("");
                      }}
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      className="ai-action-btn retry"
                      onClick={() =>
                        reopenTask.mutate({
                          id: entry.id,
                          feedback: reopenFeedback.trim() || undefined,
                        })
                      }
                    >
                      {"\u21BA"} 再実行
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="ai-action-btn retry"
                  onClick={() => {
                    setShowReopenForm(true);
                    setTimeout(() => reopenInputRef.current?.focus(), 50);
                  }}
                >
                  {"\u21BA"} もう一回やらせる
                </button>
              ))}
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
