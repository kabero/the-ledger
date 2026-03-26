import { useCallback, useEffect } from "react";

/**
 * Registers a global Escape key handler.
 * Calls the provided callback when Escape is pressed.
 */
export function useEscapeKey(handler: () => void): void {
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handler();
      }
    },
    [handler],
  );

  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);
}
