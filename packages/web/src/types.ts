export type Tab = "all" | "task" | "note" | "wish" | "done" | "unprocessed" | "llm";

export const MAIN_TABS: { key: Tab; label: string }[] = [
  { key: "task", label: "タスク" },
  { key: "llm", label: "おつかい" },
  { key: "note", label: "メモ" },
  { key: "wish", label: "ほしい" },
];
