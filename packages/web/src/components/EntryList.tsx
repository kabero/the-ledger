import { trpc } from "../trpc";

type Tab = "all" | "task" | "event" | "note" | "wish" | "done";

interface EntryListProps {
  tab: Tab;
}

export function EntryList({ tab }: EntryListProps) {
  const filter =
    tab === "all"
      ? { processed: true }
      : tab === "done"
        ? { status: "done" as const }
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

  const items = (entries.data ?? []).filter((e) => tab === "all" ? e.type !== "trash" : true);

  if (items.length === 0) {
    return <div className="unprocessed-text">まだ何もない。</div>;
  }

  return (
    <div>
      {items.map((entry) => (
        <div key={entry.id} className={`entry ${entry.status === "done" ? "done" : ""}`}>
          {entry.type === "task" && (
            <button
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
            <div>{entry.title ?? entry.raw_text}</div>
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
              {entry.priority && (
                <span className={`priority ${entry.priority >= 4 ? "high" : ""}`}>
                  {"!".repeat(entry.priority)}
                </span>
              )}
            </div>
          </div>
          <button
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
