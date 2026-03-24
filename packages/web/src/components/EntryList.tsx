import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { trpc } from "../trpc";

type Tab = "all" | "task" | "note" | "wish" | "done" | "unprocessed" | "llm";

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

  const entries = trpc.listEntries.useQuery(filter, { refetchInterval: 10_000 });
  const utils = trpc.useUtils();

  // ローカルのステータス上書き（チェック直後の見た目用、次回refetchでクリア）
  const [localStatus, setLocalStatus] = useState<Record<string, { status: string; completed_at: string | null }>>({});

  const updateEntry = trpc.updateEntry.useMutation({
    onSuccess: () => {
      utils.getTodayTasks.invalidate();
    },
  });

  const deleteEntry = trpc.deleteEntry.useMutation({
    onSuccess: () => {
      utils.listEntries.invalidate();
      utils.getTodayTasks.invalidate();
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
  const [confirmAction, setConfirmAction] = useState<{ message: string; onOk: () => void } | null>(null);

  useEffect(() => {
    document.body.style.overflow = (modalEntry || confirmAction) ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
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
        return now - new Date(e.completed_at + "Z").getTime() < DAY_MS;
      }
      if (tab !== "done" && tab !== "task" && e.status === "done") return false;
      return true;
    });
    const sorted = tab === "task"
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
      return local ? { ...e, status: local.status as typeof e.status, completed_at: local.completed_at } : e;
    });
  }, [entries.data, localStatus, tab]);

  if (items.length === 0) {
    return <div className="unprocessed-text">まだ何もない。</div>;
  }

  return (
    <>
      {confirmAction && (
        <ConfirmModal
          message={confirmAction.message}
          onOk={confirmAction.onOk}
          onCancel={() => setConfirmAction(null)}
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
        {items.map((entry) => (
          <div key={entry.id} className={`entry ${entry.status === "done" ? "done" : ""} ${entry.urgent ? "urgent" : ""}`}>
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
                      completed_at: newStatus === "done" ? new Date().toISOString().replace("T", " ").slice(0, 19) : null,
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
                {entry.image_path && (
                  <span style={{ marginRight: 4, opacity: 0.7 }} title="画像あり">
                    [IMG]
                  </span>
                )}
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
                  entry.title ?? entry.raw_text
                )}
              </div>
              <div className="entry-tags">
                {entry.type && tab === "all" && (
                  <span className="priority" style={{ marginLeft: 4 }}>
                    [{entry.type}]
                  </span>
                )}
                {entry.completed_at && (tab === "done" || tab === "llm" || tab === "task") && (
                  <span className="completed-at">
                    {new Date(entry.completed_at + "Z").toLocaleDateString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="btn-del"
              onClick={() => deleteEntry.mutate({ id: entry.id })}
            >
              x
            </button>
          </div>
        ))}
      </div>
    </>
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
  return (
    <div
      className="result-overlay"
      role="dialog"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation */}
      <div className="result-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="result-modal-close" onClick={onClose}>
          x
        </button>
        <div className="result-modal-title">{title}</div>
        <div className="result-modal-body">
          <Markdown remarkPlugins={[remarkGfm]}>{result}</Markdown>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  message,
  onOk,
  onCancel,
}: {
  message: string;
  onOk: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="result-overlay"
      role="dialog"
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation */}
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-message">{message}</div>
        <div className="confirm-buttons">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onCancel}>やめる</button>
          <button type="button" className="confirm-btn confirm-btn-ok" onClick={onOk}>戻す</button>
        </div>
      </div>
    </div>
  );
}
