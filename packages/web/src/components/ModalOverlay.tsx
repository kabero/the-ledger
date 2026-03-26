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
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation */}
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
