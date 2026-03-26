export function normalizeResult(text: string): string {
  return text.replace(/\\n/g, "\n");
}

export function formatTime(iso: string): string {
  const d = new Date(`${iso}Z`);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}日前`;
  return d.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(`${iso}Z`).toLocaleDateString("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
