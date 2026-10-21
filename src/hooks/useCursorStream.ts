import { useEffect, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Point } from "../types";

export interface CursorStream {
  /** Latest cursor position in this overlay's logical coords (may be off-window). */
  get: () => Point | null;
  subscribe: (fn: (p: Point) => void) => () => void;
}

/**
 * Global cursor position pushed from Rust (~60 Hz) via `cursor-moved`.
 * Kept out of React state so overlays don't re-render on every mouse move.
 */
export function useCursorStream(): CursorStream {
  const latestRef = useRef<Point | null>(null);
  const listenersRef = useRef(new Set<(p: Point) => void>());

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<Point>("cursor-moved", (e) => {
      latestRef.current = e.payload;
      listenersRef.current.forEach((fn) => fn(e.payload));
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return useMemo(
    () => ({
      get: () => latestRef.current,
      subscribe: (fn) => {
        listenersRef.current.add(fn);
        return () => {
          listenersRef.current.delete(fn);
        };
      },
    }),
    [],
  );
}

export function isInsideWindow(p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= window.innerWidth && p.y <= window.innerHeight;
}
