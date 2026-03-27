import { trpc } from "../trpc";

export function FocusMode() {
  const tasks = trpc.getTodayTasks.useQuery({ limit: 5 }, { refetchInterval: 10_000 });

  if (tasks.isLoading) {
    return <div className="unprocessed-text">読み込み中...</div>;
  }

  if (tasks.isError) {
    return <div className="unprocessed-text">タスクの取得に失敗しました</div>;
  }

  const pendingTasks = (tasks.data ?? []).filter((t) => t.status !== "done");

  if (pendingTasks.length === 0) {
    return (
      <div className="focus-empty">
        <div className="focus-empty-emoji">🎉</div>
        <div className="focus-empty-message">全部やった！おつかれさま</div>
        <div className="focus-empty-hint">他のタブにタスクがあるかも</div>
      </div>
    );
  }

  return (
    <div className="focus-list">
      {pendingTasks.map((task, i) => (
        <div key={task.id} className={`focus-item ${task.urgent ? "urgent" : ""}`}>
          <span className="focus-number">{i + 1}.</span>
          <span className="focus-title">{task.title ?? task.raw_text}</span>
        </div>
      ))}
    </div>
  );
}
