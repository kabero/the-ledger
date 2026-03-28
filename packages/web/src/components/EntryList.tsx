import { useEffect, useMemo, useState } from "react";
import { useBookmarks } from "../hooks/useBookmarks";
import { trpc } from "../trpc";
import { ConfirmModal } from "./ConfirmModal";
import { ResultModal } from "./ResultModal";

type Tab = "all" | "task" | "note" | "wish" | "done" | "unprocessed" | "llm";

interface EntryListProps {
  tab: Tab;
  searchQuery?: string;
}

export function EntryList({ tab, searchQuery = "" }: EntryListProps) {
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
  const [localStatus, setLocalStatus] = useState<
    Record<string, { status: string; completed_at: string | null }>
  >({});

  const updateEntry = trpc.updateEntry.useMutation({
    onSuccess: () => {
      utils.listEntries.invalidate();
    },
  });

  const deleteEntry = trpc.deleteEntry.useMutation({
    onSuccess: () => {
      utils.listEntries.invalidate();
    },
  });

  // refetch時にローカル上書きをクリア
  // biome-ignore lint/correctness/useExhaustiveDependencies: entries.dataの変更時のみクリア
  useEffect(() => {
    setLocalStatus({});
  }, [entries.data]);

  const { toggle: toggleBookmark, isBookmarked } = useBookmarks();

  const [modalEntry, setModalEntry] = useState<{ title: string; result: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ message: string; onOk: () => void } | null>(
    null,
  );

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
    // ローカル上書きを適用（位置は変えない）
    const withLocal = sorted.map((e) => {
      const local = localStatus[e.id];
      return local
        ? { ...e, status: local.status as typeof e.status, completed_at: local.completed_at }
        : e;
    });
    // ブックマークされたエントリを上部にソート
    return [...withLocal].sort((a, b) => {
      const aPin = isBookmarked(a.id) ? 0 : 1;
      const bPin = isBookmarked(b.id) ? 0 : 1;
      return aPin - bPin;
    });
  }, [entries.data, localStatus, tab, isBookmarked]);

  const visibleItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.trim().toLowerCase();
    return items.filter((e) => {
      const text = (e.title ?? e.raw_text).toLowerCase();
      return text.includes(q);
    });
  }, [items, searchQuery]);

  if (entries.isError) {
    return (
      <div className="unprocessed-text">
        読み込みエラー
        <button
          type="button"
          onClick={() => entries.refetch()}
          style={{ marginLeft: 8, cursor: "pointer" }}
        >
          再試行
        </button>
      </div>
    );
  }

  if (entries.isLoading) {
    return <div className="unprocessed-text">読み込み中...</div>;
  }

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
          okLabel="削除"
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
        {visibleItems.length === 0 && searchQuery ? (
          <div className="unprocessed-text">見つからない。</div>
        ) : (
          visibleItems.map((entry) => (
            <div
              key={entry.id}
              className={`entry ${entry.status === "done" ? "done" : ""} ${entry.urgent ? "urgent" : ""}`}
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
                    (entry.title ?? entry.raw_text)
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
                className={`btn-bookmark ${isBookmarked(entry.id) ? "active" : ""}`}
                onClick={() => toggleBookmark(entry.id)}
                aria-label={isBookmarked(entry.id) ? "ブックマーク解除" : "ブックマーク"}
                title={isBookmarked(entry.id) ? "ブックマーク解除" : "ブックマーク"}
              >
                {isBookmarked(entry.id) ? "\u2605" : "\u2606"}
              </button>
              <button
                type="button"
                className="btn-del"
                onClick={() =>
                  setConfirmAction({
                    message: `「${(entry.title ?? entry.raw_text).slice(0, 30)}」を削除しますか？`,
                    onOk: () => {
                      deleteEntry.mutate({ id: entry.id });
                      setConfirmAction(null);
                    },
                  })
                }
              >
                x
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
