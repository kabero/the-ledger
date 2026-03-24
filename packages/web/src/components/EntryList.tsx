import { useEffect, useState } from "react";
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

  const updateEntry = trpc.updateEntry.useMutation({
    onSuccess: () => {
      utils.listEntries.invalidate();
      utils.getTodayTasks.invalidate();
    },
  });

  const deleteEntry = trpc.deleteEntry.useMutation({
    onSuccess: () => {
      utils.listEntries.invalidate();
      utils.getTodayTasks.invalidate();
    },
  });

  const [modalEntry, setModalEntry] = useState<{ title: string; result: string } | null>(null);

  useEffect(() => {
    document.body.style.overflow = modalEntry ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [modalEntry]);

  const items = (entries.data ?? []).filter((e) => {
    if (tab === "unprocessed") return true;
    if (tab === "llm") return e.type !== "trash";
    if (e.type === "trash") return false;
    if (tab !== "done" && e.status === "done") return false;
    return true;
  });

  if (items.length === 0) {
    return <div className="unprocessed-text">まだ何もない。</div>;
  }

  return (
    <>
      {modalEntry && (
        <ResultModal
          title={modalEntry.title}
          result={modalEntry.result}
          onClose={() => setModalEntry(null)}
        />
      )}
      <div>
        {items.map((entry) => (
          <div key={entry.id} className={`entry ${entry.status === "done" ? "done" : ""}`}>
            {entry.type === "task" && (
              <button
                type="button"
                className="checkbox"
                onClick={() =>
                  updateEntry.mutate({
                    id: entry.id,
                    status: entry.status === "done" ? "pending" : "done",
                  })
                }
              >
                {entry.status === "done" ? "x" : ""}
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
                    onClick={() =>
                      setModalEntry({
                        title: entry.title ?? entry.raw_text,
                        result: entry.result as string,
                      })
                    }
                  >
                    {entry.title ?? entry.raw_text}
                  </button>
                ) : (
                  entry.title ?? entry.raw_text
                )}
              </div>
              <div className="entry-tags">
                {entry.tags?.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
                {entry.type && tab === "all" && (
                  <span className="priority" style={{ marginLeft: 4 }}>
                    [{entry.type}]
                  </span>
                )}
                {entry.urgent && <span className="priority high">!</span>}
                {entry.completed_at && (tab === "done" || tab === "llm") && (
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
