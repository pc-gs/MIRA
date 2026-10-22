import { useEffect, useRef } from "react";
import { isInsideWindow, type CursorStream } from "../hooks/useCursorStream";

const IDLE_SIZE = 44;
const DRAW_SIZE = 16;

interface CursorHaloProps {
  cursor: CursorStream;
  /** ⌥ is held: shrink to a ring in the ink color to signal "ready to draw". */
  drawing: boolean;
  inkColor: string;
}

/** Soft disc that follows the cursor in presenter mode so viewers never lose it. */
export function CursorHalo({ cursor, drawing, inkColor }: CursorHaloProps) {
  const posRef = useRef<HTMLDivElement>(null);

  // Positioned imperatively to avoid a React render per mouse move
  useEffect(() => {
    const place = (p: { x: number; y: number }) => {
      const el = posRef.current;
      if (!el) return;
      const inside = isInsideWindow(p);
      el.style.opacity = inside ? "1" : "0";
      if (inside) el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    };
    const initial = cursor.get();
    if (initial) place(initial);
    else if (posRef.current) posRef.current.style.opacity = "0";
    return cursor.subscribe(place);
  }, [cursor]);

  const size = drawing ? DRAW_SIZE : IDLE_SIZE;

  return (
    <div
      ref={posRef}
      className="pointer-events-none fixed left-0 top-0"
      style={{ willChange: "transform" }}
    >
      <div
        className="rounded-full"
        style={{
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2,
          background: drawing ? "transparent" : "rgba(255, 214, 10, 0.28)",
          boxShadow: drawing
            ? `0 0 0 2px ${inkColor}, 0 0 0 3.5px rgba(0,0,0,0.45)`
            : "inset 0 0 0 1.5px rgba(255, 214, 10, 0.75), 0 0 0 1px rgba(0,0,0,0.18)",
          // Animate size/color only; position follows the cursor instantly
          transition: "width 120ms ease, height 120ms ease, margin 120ms ease, background 120ms ease, box-shadow 120ms ease",
        }}
      />
    </div>
  );
}
