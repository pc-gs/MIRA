import { useEffect, useRef } from "react";
import type { CursorStream } from "../hooks/useCursorStream";

interface SpotlightProps { cursor: CursorStream; radius?: number; }

export function Spotlight({ cursor, radius = 40 }: SpotlightProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Positioned imperatively to avoid a React render per mouse move
  useEffect(() => {
    const place = (p: { x: number; y: number }) => {
      if (ref.current) ref.current.style.transform = `translate(${p.x - radius}px, ${p.y - radius}px)`;
    };
    const initial = cursor.get();
    if (initial) place(initial);
    return cursor.subscribe(place);
  }, [cursor, radius]);

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed"
      style={{
        left: 0, top: 0,
        width: radius * 2, height: radius * 2,
        borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.85)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.3), 0 0 12px rgba(255,255,255,0.4)",
        backdropFilter: "brightness(1.15)",
        willChange: "transform",
      }}
    />
  );
}
