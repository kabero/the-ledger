import { useCallback, useMemo, useState } from "react";
import { POLL } from "../poll";
import { trpc } from "../trpc";

/**
 * Detects overdue tasks and provides dismiss/count state.
 */
export function useOverdueDetection(pausePolling: boolean) {
  const pendingTasks = trpc.listEntries.useQuery(
    { type: "task", status: "pending", limit: 100 },
    { refetchInterval: pausePolling ? false : POLL.entries },
  );

  const [overdueDismissed, setOverdueDismissed] = useState(() => {
    const stored = localStorage.getItem("overdue-dismissed");
    if (!stored) return false;
    const today = new Date().toISOString().slice(0, 10);
    return stored === today;
  });

  const handleOverdueDismiss = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem("overdue-dismissed", today);
    setOverdueDismissed(true);
  }, []);

  const overdueCount = useMemo(() => {
    if (!pendingTasks.data) return 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return pendingTasks.data.filter((e) => {
      if (!e.due_date) return false;
      const due = new Date(`${e.due_date}T00:00:00`);
      return due.getTime() < now.getTime();
    }).length;
  }, [pendingTasks.data]);

  return { overdueCount, overdueDismissed, handleOverdueDismiss };
}
