import { trpc } from "../trpc";

export function TodayTasks() {
  const todayTasks = trpc.getTodayTasks.useQuery({});
  const utils = trpc.useUtils();

  const updateEntry = trpc.updateEntry.useMutation({
    onSuccess: () => {
      utils.getTodayTasks.invalidate();
      utils.listEntries.invalidate();
    },
  });

  const tasks = todayTasks.data ?? [];

  if (tasks.length === 0) {
    return (
      <div className="box">
        <span className="box-title">今日の 3 つ</span>
        <div className="unprocessed-text">タスクはまだない。何か投げろ。</div>
      </div>
    );
  }

  return (
    <div className="box">
      <span className="box-title">今日の 3 つ</span>
      {tasks.map((task) => (
        <div key={task.id} className={`entry ${task.status === "done" ? "done" : ""}`}>
          <button
            className="checkbox"
            onClick={() =>
              updateEntry.mutate({
                id: task.id,
                status: task.status === "done" ? "pending" : "done",
              })
            }
          >
            {task.status === "done" ? "x" : ""}
          </button>
          <div>
            <div className="entry-title">{task.title ?? task.raw_text}</div>
            {task.priority && (
              <span className={`priority ${task.priority >= 4 ? "high" : ""}`}>
                P{task.priority}
              </span>
            )}
            {task.due_date && (
              <span className="priority" style={{ marginLeft: 8 }}>
                {task.due_date}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
