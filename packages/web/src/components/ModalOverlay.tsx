import type { ReactNode } from "react";

interface ModalOverlayProps {
  /** CSS class for the overlay, defaults to "result-overlay" */
  className?: string;
  /** aria-label for the dialog */
  ariaLabel?: string;
  /** Called when backdrop is clicked or Escape is pressed */
  onClose: () => void;
  children: ReactNode;
}

/**
 * Reusable modal overlay with backdrop click and Escape key handling.
 * Prevents click propagation from the content area.
 */
export function ModalOverlay({
  className = "result-overlay",
  ariaLabel,
  onClose,
  children,
}: ModalOverlayProps) {
  return (
    <div
      className={className}
      role="dialog"
      aria-label={ariaLabel}
      onClick={(e) => {
        // Only close when clicking directly on the overlay backdrop,
        // not when clicking content inside.  The previous approach used
        // stopPropagation on an inner wrapper <div>, but on mobile
        // (touch-synthesized clicks) that wrapper could fail to intercept
        // the event, causing the sheet to close on every tap.
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      {children}
    </div>
  );
}
