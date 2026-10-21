import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildFreehandPath } from "../hooks/useDrawing";
import type { Point } from "../types";

const MIN_LEVEL = 1;
const MAX_LEVEL = 8;
const START_LEVEL = 2;
const WHEEL_STEP = 1.15;
const HUD_MS = 1800;

interface Hud {
  level: number;
  locked: boolean;
}

interface ZoomStroke {
  color: string;
  width: number;
  points: Point[];
}

interface ZoomViewProps {
  initialCursor: Point | null;
  color: string;
  lineWidth: number;
  /** Click-through state to restore when zoom ends (depends on draw mode). */
  getPassThrough: () => boolean;
  onExit: () => void;
  onError: (message: string) => void;
}

/**
 * ZoomIt-style zoom: a frozen snapshot of this monitor, magnified around the cursor.
 * Mouse pans, wheel changes level, left-drag draws (and locks the view), Esc/right-click exits.
 * Drawings made here are temporary and vanish on exit.
 */
export function ZoomView({ initialCursor, color, lineWidth, getPassThrough, onExit, onError }: ZoomViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [hudVisible, setHudVisible] = useState(false);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHudRef = useRef((next: Hud) => {
    setHud(next);
    setHudVisible(true);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => setHudVisible(false), HUD_MS);
  });
  const styleRef = useRef({ color, lineWidth });
  styleRef.current = { color, lineWidth };
  const callbacksRef = useRef({ getPassThrough, onExit, onError });
  callbacksRef.current = { getPassThrough, onExit, onError };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let cancelled = false;
    let bitmap: ImageBitmap | null = null;
    let raf = 0;
    let level = START_LEVEL;
    let targetLevel = START_LEVEL;
    let cursor: Point = initialCursor ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let frozen: { sx: number; sy: number; sw: number; sh: number } | null = null;
    const strokes: ZoomStroke[] = [];
    let current: ZoomStroke | null = null;

    const endZoom = () =>
      invoke("end_zoom", { passThrough: callbacksRef.current.getPassThrough() }).catch(console.error);

    const sourceRect = () => {
      if (frozen) return frozen;
      const bw = bitmap!.width;
      const bh = bitmap!.height;
      const sw = bw / level;
      const sh = bh / level;
      // Cursor position maps proportionally across the whole screen
      const fx = Math.min(1, Math.max(0, cursor.x / window.innerWidth));
      const fy = Math.min(1, Math.max(0, cursor.y / window.innerHeight));
      return { sx: fx * (bw - sw), sy: fy * (bh - sh), sw, sh };
    };

    const frame = () => {
      raf = 0;
      if (!bitmap) return;
      if (!frozen && Math.abs(targetLevel - level) > 0.001) {
        level += (targetLevel - level) * 0.3;
        schedule();
      } else if (!frozen) {
        level = targetLevel;
      }

      const w = window.innerWidth;
      const h = window.innerHeight;
      const { sx, sy, sw, sh } = sourceRect();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of current ? [...strokes, current] : strokes) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        buildFreehandPath(ctx, s.points);
        ctx.stroke();
      }
    };

    function schedule() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      schedule();
    };

    const pointFrom = (e: PointerEvent | MouseEvent): Point => ({ x: e.clientX, y: e.clientY });

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) {
        callbacksRef.current.onExit();
        return;
      }
      if (e.button !== 0 || !bitmap) return;
      canvas.setPointerCapture(e.pointerId);
      // First stroke locks the view so drawings stay aligned with the content
      if (!frozen) {
        frozen = sourceRect();
        showHudRef.current({ level, locked: true });
      }
      const { color: c, lineWidth: lw } = styleRef.current;
      current = { color: c, width: lw, points: [pointFrom(e)] };
      schedule();
    };

    const onPointerMove = (e: PointerEvent) => {
      const pt = pointFrom(e);
      if (current) {
        const last = current.points[current.points.length - 1];
        if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 1.5) current.points.push(pt);
      } else {
        cursor = pt;
      }
      schedule();
    };

    const onPointerUp = () => {
      if (!current) return;
      if (current.points.length > 1) strokes.push(current);
      current = null;
      schedule();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (frozen) return;
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      targetLevel = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, targetLevel * factor));
      showHudRef.current({ level: targetLevel, locked: false });
      schedule();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        callbacksRef.current.onExit();
      }
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKey);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);

    (async () => {
      try {
        const buf = await invoke<ArrayBuffer>("begin_zoom");
        if (cancelled) {
          // Exited before the capture finished: undo what begin_zoom changed
          void endZoom();
          return;
        }
        const view = new DataView(buf);
        const width = view.getUint32(0, true);
        const height = view.getUint32(4, true);
        const pixels = new Uint8ClampedArray(buf, 8, width * height * 4);
        const decoded = await createImageBitmap(new ImageData(pixels, width, height));
        if (cancelled) {
          decoded.close();
          return;
        }
        bitmap = decoded;
        showHudRef.current({ level: targetLevel, locked: false });
        schedule();
      } catch (err) {
        if (!cancelled) callbacksRef.current.onError(String(err));
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      if (raf) cancelAnimationFrame(raf);
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
      bitmap?.close();
      void endZoom();
    };
    // Mount-only: initialCursor is just the starting point
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: "crosshair", touchAction: "none" }}
      />
      {/* Thin frame so it's obvious the screen is frozen */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{ boxShadow: "inset 0 0 0 2px rgba(10,132,255,0.55), inset 0 0 40px rgba(10,132,255,0.12)" }}
      />
      {hud && (
        <div
          className="pointer-events-none fixed bottom-8 left-1/2 flex items-center gap-3 px-4 h-10 rounded-full text-[13px] text-zinc-100 transition-all duration-300"
          style={{
            transform: `translateX(-50%) translateY(${hudVisible ? 0 : 8}px)`,
            opacity: hudVisible ? 1 : 0,
            background: "rgba(24,24,27,0.82)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1), 0 10px 30px -8px rgba(0,0,0,0.6)",
            backdropFilter: "blur(12px)",
            fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          }}
        >
          <span className="font-semibold tabular-nums text-white">{hud.level.toFixed(1)}×</span>
          <span className="w-px h-4 bg-white/15" />
          <span className="text-zinc-400">
            {hud.locked ? "View locked while drawing" : "Scroll to zoom · drag to draw"} · Esc to exit
          </span>
        </div>
      )}
    </>
  );
}
