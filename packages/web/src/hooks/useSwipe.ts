import { useCallback, useRef } from "react";

interface UseSwipeOptions {
  threshold?: number;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

/**
 * Touch swipe handler. Returns event handlers for onTouchStart, onTouchMove, onTouchEnd.
 */
export function useSwipe({ threshold = 80, onSwipeLeft, onSwipeRight }: UseSwipeOptions) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchEndX = useRef(-1);
  const touchEndY = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchEndX.current = -1;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
    touchEndY.current = e.touches[0].clientY;
  }, []);

  const onTouchEnd = useCallback(() => {
    if (touchEndX.current === -1) return;
    const diffX = touchStartX.current - touchEndX.current;
    const diffY = Math.abs(touchStartY.current - touchEndY.current);
    // Ignore if vertical movement exceeds horizontal (scrolling, not swiping)
    if (diffY > Math.abs(diffX)) return;
    if (Math.abs(diffX) < threshold) return;

    if (diffX > 0) {
      onSwipeLeft?.();
    } else {
      onSwipeRight?.();
    }
  }, [threshold, onSwipeLeft, onSwipeRight]);

  return { onTouchStart, onTouchMove, onTouchEnd };
}
