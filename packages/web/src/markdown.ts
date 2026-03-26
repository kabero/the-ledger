import remarkGfm from "remark-gfm";

/**
 * Shared Markdown configuration for consistent rendering and security.
 * All Markdown components should use these settings.
 */

export const remarkPlugins = [remarkGfm];

/** Block javascript: and other dangerous URL schemes */
export function safeUrlTransform(url: string): string {
  const trimmed = url.trim().toLowerCase();
  if (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("vbscript:") ||
    trimmed.startsWith("data:")
  ) {
    return "";
  }
  return url;
}
