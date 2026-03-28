import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "theledger-bookmarks";

function getBookmarks(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveBookmarks(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  window.dispatchEvent(new Event("bookmarks-changed"));
}

let cache: Set<string> | null = null;

function subscribe(cb: () => void) {
  const handler = () => {
    cache = null;
    cb();
  };
  window.addEventListener("bookmarks-changed", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("bookmarks-changed", handler);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot(): Set<string> {
  if (!cache) {
    cache = getBookmarks();
  }
  return cache;
}

export function useBookmarks() {
  const bookmarks = useSyncExternalStore(subscribe, getSnapshot);

  const toggle = useCallback((id: string) => {
    const current = getBookmarks();
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    cache = null;
    saveBookmarks(current);
  }, []);

  const isBookmarked = useCallback((id: string) => bookmarks.has(id), [bookmarks]);

  return { bookmarks, toggle, isBookmarked };
}
