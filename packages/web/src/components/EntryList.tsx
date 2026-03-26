import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { remarkPlugins, safeUrlTransform } from "../markdown";
import { POLL } from "../poll";
import { trpc } from "../trpc";

type Tab = "all" | "task" | "note" | "wish" | "done" | "unprocessed" | "llm";
type EntryRow = ReturnType<typeof trpc.listEntries.useQuery>["data"] extends (infer T)[] | undefined
  ? T & { status: string | null; completed_at: string | null }
  : never;

interface EntryListProps {
  tab: Tab;
}

export function EntryList({ tab }: EntryListProps) {
  const filter =
    tab === "all"
      ? { processed: true }
      : tab === "done"
        ? { status: "done" as const, sort: "completed_at" as const }
        : tab === "unprocessed"
          ? { processed: false }
          : tab === "llm"
            ? { delegatable: true }
            : { type: tab as "task" | "note" | "wish" };

  const entries = trpc.listEntries.useQuery(filter, { refetchInterval: POLL.entries });
  const utils = trpc.useUtils();

  // ローカルのステータス上書き（チェック直後の見た目用、次回refetchでクリア）
  const [localStatus, setLocalStatus] = useState<
    Record<string, { status: string; completed_at: string | null }>
  >({});

  const updateEntry = trpc.updateEntry.useMutation({
    onError: () => {
      // Rollback optimistic local status on error
      setLocalStatus({});
      utils.listEntries.invalidate();
    },
  });

  const deleteEntry = trpc.deleteEntry.useMutation({
    onSuccess: () => {
      utils.listEntries.invalidate();
    },
    onError: () => {
      utils.listEntries.invalidate();
    },
  });

  // refetch時にローカル上書きをクリア
  const prevDataRef = useRef(entries.data);
  if (entries.data !== prevDataRef.current) {
    prevDataRef.current = entries.data;
    if (Object.keys(localStatus).length > 0) {
      setLocalStatus({});
    }
  }

  const [modalEntry, setModalEntry] = useState<{ title: string; result: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    message: string;
    onOk: () => void;
    okLabel?: string;
  } | null>(null);

  useEffect(() => {
    document.body.style.overflow = modalEntry || confirmAction ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [modalEntry, confirmAction]);

  const DAY_MS = 24 * 60 * 60 * 1000;

  const items = useMemo(() => {
    const now = Date.now();
    const raw = entries.data ?? [];
    // まずサーバーデータでフィルタ・ソート（位置確定）
    const filtered = raw.filter((e) => {
      if (tab === "unprocessed") return true;
      if (tab === "llm") return e.type !== "trash";
      if (e.type === "trash") return false;
      if (tab === "task" && e.delegatable) return false;
      if (tab === "task" && e.status === "done") {
        if (!e.completed_at) return false;
        return now - new Date(`${e.completed_at}Z`).getTime() < DAY_MS;
      }
      if (tab !== "done" && tab !== "task" && e.status === "done") return false;
      return true;
    });
    const sorted =
      tab === "task"
        ? [...filtered].sort((a, b) => {
            const aDone = a.status === "done" ? 1 : 0;
            const bDone = b.status === "done" ? 1 : 0;
            if (aDone !== bDone) return aDone - bDone;
            if (aDone && bDone) {
              return (b.completed_at ?? "").localeCompare(a.completed_at ?? "");
            }
            return 0;
          })
        : filtered;
    // 最後にローカル上書きを適用（位置は変えない）
    return sorted.map((e) => {
      const local = localStatus[e.id];
      return local
        ? { ...e, status: local.status as typeof e.status, completed_at: local.completed_at }
        : e;
    });
  }, [entries.data, localStatus, tab]);

  const renderEntry = useCallback(
    (entry: EntryRow) => (
      <div
        key={entry.id}
        className={`entry ${entry.status === "done" ? "done" : ""} ${entry.urgent ? "urgent" : ""} ${entry.result_url ? "has-url" : ""}`}
      >
        {entry.type === "task" && (
          <button
            type="button"
            className="checkbox"
            onClick={() => {
              const newStatus = entry.status === "done" ? "pending" : "done";
              if (tab === "llm" && newStatus === "pending") {
                setConfirmAction({
                  message: "おつかいの成果があるけど、未完了に戻しますか？",
                  onOk: () => {
                    setLocalStatus((prev) => ({
                      ...prev,
                      [entry.id]: { status: "pending", completed_at: null },
                    }));
                    updateEntry.mutate({ id: entry.id, status: "pending" });
                    setConfirmAction(null);
                  },
                });
                return;
              }
              setLocalStatus((prev) => ({
                ...prev,
                [entry.id]: {
                  status: newStatus,
                  completed_at:
                    newStatus === "done"
                      ? new Date().toISOString().replace("T", " ").slice(0, 19)
                      : null,
                },
              }));
              updateEntry.mutate({ id: entry.id, status: newStatus });
            }}
          >
            {entry.status === "done" ? "\u2713" : ""}
          </button>
        )}
        <div className="entry-title">
          <div>
            {entry.result ? (
              <button
                type="button"
                className="btn-result-title"
                onClick={() => {
                  setModalEntry({
                    title: entry.title ?? entry.raw_text,
                    result: entry.result as string,
                  });
                  if (!entry.result_seen) {
                    updateEntry.mutate({ id: entry.id, result_seen: true });
                  }
                }}
              >
                {!entry.result_seen && <span className="badge-new">NEW</span>}
                {entry.title ?? entry.raw_text}
              </button>
            ) : (
              (entry.title ?? entry.raw_text)
            )}
            {entry.result_url && (
              <a
                href={entry.result_url}
                target="_blank"
                rel="noopener noreferrer"
                className="entry-result-url"
                onClick={(e) => e.stopPropagation()}
              >
                {"\u2197"} URL
              </a>
            )}
          </div>
          <div className="entry-tags">
            {entry.type && tab === "all" && (
              <span className="priority" style={{ marginLeft: 4 }}>
                [{entry.type}]
              </span>
            )}
            {entry.due_date &&
              entry.status !== "done" &&
              (() => {
                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const due = new Date(`${entry.due_date}T00:00:00`);
                const diff = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                const cls = diff < 0 ? "overdue" : diff <= 3 ? "soon" : "";
                const dateStr = due.toLocaleDateString("ja-JP", {
                  month: "short",
                  day: "numeric",
                });
                const remain =
                  diff < 0
                    ? `${-diff}日超過`
                    : diff === 0
                      ? "今日"
                      : diff === 1
                        ? "明日"
                        : `あと${diff}日`;
                return (
                  <span className={`due-date ${cls}`}>
                    {dateStr}（{remain}）
                  </span>
                );
              })()}
            {entry.completed_at && (tab === "done" || tab === "llm" || tab === "task") && (
              <span className="completed-at">
                {new Date(`${entry.completed_at}Z`).toLocaleDateString("ja-JP", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn-del"
          aria-label="削除"
          onClick={() => {
            setConfirmAction({
              message: `「${entry.title ?? entry.raw_text}」を削除しますか？`,
              okLabel: "削除",
              onOk: () => {
                deleteEntry.mutate({ id: entry.id });
                setConfirmAction(null);
              },
            });
          }}
        >
          x
        </button>
      </div>
    ),
    [tab, updateEntry, deleteEntry],
  );

  const pending = useMemo(
    () => (tab === "task" ? items.filter((e) => e.status !== "done") : items),
    [items, tab],
  );
  const done = useMemo(
    () => (tab === "task" ? items.filter((e) => e.status === "done") : []),
    [items, tab],
  );

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">まだ何もない。</div>
        <div className="empty-state-hint">
          頭の中にあること、なんでも書いてみて。
          <br />
          <span className="empty-state-arrow">{"+"} を押して入力スタート</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {confirmAction && (
        <ConfirmModal
          message={confirmAction.message}
          onOk={confirmAction.onOk}
          onCancel={() => setConfirmAction(null)}
          okLabel={confirmAction.okLabel}
        />
      )}
      {modalEntry && (
        <ResultModal
          title={modalEntry.title}
          result={modalEntry.result}
          onClose={() => setModalEntry(null)}
        />
      )}
      <div>
        {pending.map(renderEntry)}
        {done.length > 0 && <DoneSection items={done} renderEntry={renderEntry} />}
      </div>
    </>
  );
}

function DoneSection({
  items,
  renderEntry,
}: {
  items: EntryRow[];
  renderEntry: (entry: EntryRow) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="done-section">
      <button type="button" className="done-section-toggle" onClick={() => setOpen(!open)}>
        {open ? "\u25BC" : "\u25B6"} 完了済み ({items.length})
      </button>
      {open && items.map((entry) => renderEntry(entry))}
    </div>
  );
}

function ResultModal({
  title,
  result,
  onClose,
}: {
  title: string;
  result: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result);
      } else {
        // Fallback for older browsers
        const textarea = document.createElement("textarea");
        textarea.value = result;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Show error feedback if both methods fail
      console.error("Failed to copy to clipboard");
    }
  };

  return (
    <div
      className="result-overlay"
      role="dialog"
      aria-label={title}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation */}
      <div className="result-modal" onClick={(e) => e.stopPropagation()}>
        <div className="result-modal-header">
          <button
            type="button"
            className={`result-modal-copy ${copied ? "copied" : ""}`}
            onClick={handleCopy}
          >
            {copied ? "\u2713 copied" : "copy"}
          </button>
          <button type="button" className="result-modal-close" onClick={onClose}>
            x
          </button>
        </div>
        <div className="result-modal-title">{title}</div>
        <div className="result-modal-body">
          <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
            {result.replace(/\\n/g, "\n")}
          </Markdown>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  message,
  onOk,
  onCancel,
  okLabel = "戻す",
}: {
  message: string;
  onOk: () => void;
  onCancel: () => void;
  okLabel?: string;
}) {
  return (
    <div
      className="result-overlay"
      role="dialog"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation */}
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-message">{message}</div>
        <div className="confirm-buttons">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onCancel}>
            やめる
          </button>
          <button type="button" className="confirm-btn confirm-btn-ok" onClick={onOk}>
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
