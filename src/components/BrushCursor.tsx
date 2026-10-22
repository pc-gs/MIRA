import { useEffect, useRef } from "react";
import { isInsideWindow, type CursorStream } from "../hooks/useCursorStream";
import type { Tool } from "../types";

// Matches HIGHLIGHTER_WIDTH_FACTOR in useDrawing: the highlighter paints much wider
const HIGHLIGHTER_FACTOR = 3.5;
const MIN_DOT = 5;

const SHAPE_GLYPHS: Partial<Record<Tool, string>> = {
  line: "╱",
  arrow: "↗",
  rectangle: "▭",
  ellipse: "◯",
};

interface BrushCursorProps {
  cursor: CursorStream;
  tool: Tool;
  color: string;
  lineWidth: number;
}

/**
 * Replaces the system cursor in draw mode with a preview of the ink: a dot as wide as
 * the stroke, in its color, plus a small glyph for shape tools.
 */
export function BrushCursor({ cursor, tool, color, lineWidth }: BrushCursorProps) {
  const posRef = useRef<HTMLDivElement>(null);

  // Positioned imperatively; pointermove keeps it in step with the ink while the
  // Rust cursor stream covers the moments the overlay gets no pointer events.
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
    const onMove = (e: PointerEvent) => place({ x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", onMove);
    const unsubscribe = cursor.subscribe(place);
    return () => {
      window.removeEventListener("pointermove", onMove);
      unsubscribe();
    };
  }, [cursor]);

  const highlighter = tool === "highlighter";
  const size = Math.max(MIN_DOT, highlighter ? lineWidth * HIGHLIGHTER_FACTOR : lineWidth);
  const glyph = SHAPE_GLYPHS[tool];

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
          background: color,
          opacity: highlighter ? 0.55 : 1,
          // Light + dark rings keep it visible on any background, even in white/black ink
          boxShadow: "0 0 0 1px rgba(255,255,255,0.9), 0 0 0 2px rgba(0,0,0,0.45)",
          transition: "width 100ms ease, height 100ms ease, margin 100ms ease",
        }}
      />
      {glyph && (
        <div
          className="absolute flex items-center justify-center w-[18px] h-[18px] rounded-[5px] text-[12px] leading-none text-white"
          style={{
            left: 10,
            top: 10,
            background: "rgba(24,24,27,0.82)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)",
            fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          }}
        >
          {glyph}
        </div>
      )}
    </div>
  );
}
