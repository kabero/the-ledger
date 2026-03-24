import { trpc } from "../trpc";

type Tab = "all" | "task" | "event" | "note" | "wish" | "done" | "unprocessed";

interface EntryListProps {
  tab: Tab;
}

export function EntryList({ tab }: EntryListProps) {
  const filter =
    tab === "all"
      ? { processed: true }
      : tab === "done"
        ? { status: "done" as const }
        : tab === "unprocessed"
          ? { processed: false }
          : { type: tab as "task" | "event" | "note" | "wish" };

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

  const items = (entries.data ?? []).filter((e) => {
    if (tab === "unprocessed") return true;
    if (e.type === "trash") return false;
    if (tab !== "done" && e.status === "done") return false;
    return true;
  });

  if (items.length === 0) {
    return <div className="unprocessed-text">まだ何もない。</div>;
  }

  return (
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
              {entry.title ?? entry.raw_text}
            </div>
            <div className="entry-tags">
              {entry.tags?.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
              {entry.type && (
                <span className="priority" style={{ marginLeft: 4 }}>
                  [{entry.type}]
                </span>
              )}
              {entry.urgent && <span className="priority high">!</span>}
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
  );
}
