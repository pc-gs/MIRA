import { useEffect, useRef } from "react";
import { isInsideWindow, type CursorStream } from "../hooks/useCursorStream";

const TRAIL_MS = 350;
const DOT_RADIUS = 6;

interface LaserPointerProps {
  cursor: CursorStream;
  color: string;
}

/** Glowing dot with a fading trail. Purely visual: the overlay stays click-through. */
export function LaserPointer({ cursor, color }: LaserPointerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef(color);
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    colorRef.current = color;
    redrawRef.current();
  }, [color]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const trail: Array<{ x: number; y: number; t: number }> = [];
    let head: { x: number; y: number } | null = null;
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      schedule();
    };

    const frame = () => {
      raf = 0;
      const now = performance.now();
      while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const c = colorRef.current;
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineCap = "round";

      // Trail segments thin out and fade with age
      for (let i = 1; i < trail.length; i++) {
        const life = 1 - (now - trail[i].t) / TRAIL_MS;
        ctx.globalAlpha = Math.max(0, life) * 0.75;
        ctx.lineWidth = 1.5 + life * (DOT_RADIUS * 1.4);
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }

      if (head) {
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.shadowColor = c;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(head.x, head.y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(head.x, head.y, DOT_RADIUS * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Keep animating only while there is trail left to fade
      if (trail.length) schedule();
    };

    function schedule() {
      if (!raf) raf = requestAnimationFrame(frame);
    }
    redrawRef.current = schedule;

    const onMove = (p: { x: number; y: number }) => {
      if (isInsideWindow(p)) {
        trail.push({ x: p.x, y: p.y, t: performance.now() });
        head = p;
      } else {
        // Cursor is on another monitor: break the trail
        trail.length = 0;
        head = null;
      }
      schedule();
    };

    const initial = cursor.get();
    if (initial && isInsideWindow(initial)) head = initial;

    resize();
    window.addEventListener("resize", resize);
    const unsubscribe = cursor.subscribe(onMove);
    return () => {
      unsubscribe();
      window.removeEventListener("resize", resize);
      if (raf) cancelAnimationFrame(raf);
      redrawRef.current = () => {};
    };
  }, [cursor]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}
