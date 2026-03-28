export function normalizeResult(text: string): string {
  return text.replace(/\\n/g, "\n");
}

interface BadgeStyles {
  url: string;
  research: string;
  summary: string;
  generic: string;
}

/** Classify the result type for badge display. */
export function getResultBadge(
  entry: { result?: string | null; result_url?: string | null },
  cls: BadgeStyles,
): { label: string; className: string } | null {
  if (entry.result_url) {
    return { label: "URL", className: cls.url };
  }
  if (!entry.result) return null;

  const lower = normalizeResult(entry.result).toLowerCase();

  if (
    lower.includes("調査") ||
    lower.includes("リサーチ") ||
    lower.includes("research") ||
    lower.includes("investigation") ||
    lower.includes("分析") ||
    lower.includes("検証")
  ) {
    return { label: "調査", className: cls.research };
  }

  if (
    lower.includes("サマリ") ||
    lower.includes("まとめ") ||
    lower.includes("要約") ||
    lower.includes("summary") ||
    lower.includes("概要")
  ) {
    return { label: "サマリ", className: cls.summary };
  }

  return { label: "結果あり", className: cls.generic };
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

export function formatElapsed(iso: string): string {
  const d = new Date(`${iso}Z`);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "0m";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  const remainMin = diffMin % 60;
  if (diffHour < 24) return `${diffHour}h${remainMin > 0 ? `${remainMin}m` : ""}`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d${diffHour % 24}h`;
}

export function formatDateTime(iso: string): string {
  return new Date(`${iso}Z`).toLocaleDateString("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
