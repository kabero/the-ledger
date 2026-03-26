/**
 * Centralized polling intervals.
 * Override in dev by setting VITE_POLL_MULTIPLIER (e.g. "3" = 3x slower).
 */
const multiplier = Number(import.meta.env.VITE_POLL_MULTIPLIER) || 1;

const ms = (base: number) => base * multiplier;

export const POLL = {
  /** Main entry list & graph view */
  entries: ms(10_000),
  /** Unprocessed items check */
  unprocessed: ms(12_000),
  /** AI delegatable tasks */
  delegatable: ms(10_000),
  /** AI sourced entries */
  sourced: ms(15_000),
  /** AI human tasks */
  humanTasks: ms(18_000),
  /** Pending decisions (delegatable: false, needs human judgment) */
  pendingDecisions: ms(12_000),
  /** Sidebar external entries (slower) */
  sidebarSourced: ms(30_000),
} as const;
