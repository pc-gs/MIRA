import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

const RIPPLE_MS = 450;
const MAX_RIPPLES = 4;

interface Ripple {
  id: number;
  x: number;
  y: number;
}

let nextId = 0;

/** Expanding ring wherever the user clicks (presenter mode + "Highlight Clicks"). */
export function ClickRipples() {
  const [ripples, setRipples] = useState<Ripple[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    void listen<{ x: number; y: number }>("mouse-clicked", (e) => {
      const ripple = { id: nextId++, x: e.payload.x, y: e.payload.y };
      setRipples((prev) => [...prev.slice(-(MAX_RIPPLES - 1)), ripple]);
      const t = setTimeout(() => {
        timers.delete(t);
        setRipples((prev) => prev.filter((r) => r.id !== ripple.id));
      }, RIPPLE_MS + 50);
      timers.add(t);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <>
      <style>{`
        @keyframes mira-ripple {
          0%   { transform: translate(-50%, -50%) scale(0.15); opacity: 1; }
          55%  { opacity: 0.9; }
          100% { transform: translate(-50%, -50%) scale(1);    opacity: 0; }
        }
      `}</style>
      {ripples.map((r) => (
        <div
          key={r.id}
          className="pointer-events-none fixed rounded-full"
          style={{
            left: r.x,
            top: r.y,
            width: 56,
            height: 56,
            // Yellow ring (matches the halo) with dark outlines: readable on any background
            boxShadow:
              "inset 0 0 0 3.5px rgba(255,214,10,0.95), inset 0 0 0 5px rgba(0,0,0,0.35), 0 0 0 1.5px rgba(0,0,0,0.35), 0 0 12px rgba(255,214,10,0.45)",
            animation: `mira-ripple ${RIPPLE_MS}ms ease-out forwards`,
          }}
        />
      ))}
    </>
  );
}
