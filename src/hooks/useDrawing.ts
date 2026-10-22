import { useRef, useCallback, useEffect } from "react";
import type { Stroke, Point, Tool } from "../types";

// ── Geometry helpers ──────────────────────────────────────────────────────────

function constrainTo45Degrees(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const distance = Math.hypot(dx, dy);
  const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: start.x + Math.cos(snapAngle) * distance,
    y: start.y + Math.sin(snapAngle) * distance,
  };
}

function constrainToSquare(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const maxDist = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + (dx >= 0 ? maxDist : -maxDist),
    y: start.y + (dy >= 0 ? maxDist : -maxDist),
  };
}

function applyShiftConstraint(start: Point, end: Point, tool: Tool): Point {
  if (tool === "line" || tool === "arrow") return constrainTo45Degrees(start, end);
  if (tool === "rectangle" || tool === "ellipse") return constrainToSquare(start, end);
  return end;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const HIGHLIGHTER_WIDTH_FACTOR = 3.5;

/** Width actually painted on screen (highlighter is drawn much wider than its size). */
function renderedWidth(stroke: Stroke): number {
  return stroke.tool === "highlighter" ? stroke.width * HIGHLIGHTER_WIDTH_FACTOR : stroke.width;
}

function strokeHitsPoint(stroke: Stroke, pt: Point, eraserRadius: number): boolean {
  // Count the stroke's own thickness so touching its visible edge erases it
  const radius = stroke.tool === "text" ? eraserRadius : eraserRadius + renderedWidth(stroke) / 2;
  if (stroke.tool === "pen" || stroke.tool === "highlighter") {
    if (!stroke.points || stroke.points.length === 0) return false;
    if (stroke.points.length === 1) {
      return Math.hypot(pt.x - stroke.points[0].x, pt.y - stroke.points[0].y) <= radius;
    }
    for (let i = 0; i < stroke.points.length - 1; i++) {
      if (distanceToSegment(pt, stroke.points[i], stroke.points[i + 1]) <= radius) {
        return true;
      }
    }
    return false;
  }

  if (stroke.tool === "text" && stroke.position && stroke.text) {
    // Approximate hit box; precise measure happens in findTextStrokeAt when ctx is available.
    const fontH = stroke.width * 3.5;
    const approxW = stroke.text.length * (stroke.width * 2);
    return (
      pt.x >= stroke.position.x - radius &&
      pt.x <= stroke.position.x + approxW + radius &&
      pt.y >= stroke.position.y - fontH / 2 - radius &&
      pt.y <= stroke.position.y + fontH / 2 + radius
    );
  }

  if (stroke.start && stroke.end) {
    if (stroke.tool === "line" || stroke.tool === "arrow") {
      return distanceToSegment(pt, stroke.start, stroke.end) <= radius;
    }
    if (stroke.tool === "rectangle" || stroke.tool === "ellipse") {
      const minX = Math.min(stroke.start.x, stroke.end.x) - radius;
      const maxX = Math.max(stroke.start.x, stroke.end.x) + radius;
      const minY = Math.min(stroke.start.y, stroke.end.y) - radius;
      const maxY = Math.max(stroke.start.y, stroke.end.y) + radius;
      return pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;
    }
  }
  return false;
}

function newStrokeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function cloneStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map((s) => ({
    ...s,
    points: s.points ? s.points.map((p) => ({ ...p })) : undefined,
    start: s.start ? { ...s.start } : undefined,
    end: s.end ? { ...s.end } : undefined,
    position: s.position ? { ...s.position } : undefined,
  }));
}

/** Smooth freehand path used for both live preview and committed strokes. */
export function buildFreehandPath(ctx: CanvasRenderingContext2D, points: Point[]) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

function clearFull(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseDrawingOptions {
  color: string;
  lineWidth: number;
  enabled: boolean;
  tool: Tool;
  /** Fading ink: finished strokes skip history and disappear after a few seconds. */
  fade: boolean;
}

const MAX_HISTORY = 80;
export const HIGHLIGHTER_ALPHA = 0.4;
const FADE_HOLD_MS = 2500;
const FADE_OUT_MS = 800;

interface EphemeralStroke {
  stroke: Stroke;
  createdAt: number;
}

export function useDrawing({ color, lineWidth, enabled, tool, fade }: UseDrawingOptions) {
  const hlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const pastRef = useRef<Stroke[][]>([]);
  const futureRef = useRef<Stroke[][]>([]);
  const currentPointsRef = useRef<Point[]>([]);
  const previewStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef(false);
  const eraseHistoryPushedRef = useRef(false);
  const ephemeralRef = useRef<EphemeralStroke[]>([]);
  const fadeRafRef = useRef(0);
  const hiddenIdRef = useRef<string | null>(null);
  const fadeRef = useRef(fade);
  fadeRef.current = fade;

  const getBgCtx = useCallback(() => bgCanvasRef.current?.getContext("2d") ?? null, []);
  const getFgCtx = useCallback(() => fgCanvasRef.current?.getContext("2d") ?? null, []);

  /**
   * `highlighterAlpha` is 1 when painting into the highlight layer (whose CSS opacity
   * provides the translucency, so overlapping highlights don't stack darker).
   */
  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke, highlighterAlpha = HIGHLIGHTER_ALPHA, alpha = 1) => {
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = alpha;

    if (stroke.tool === "text") {
      if (!stroke.text || !stroke.position) return;
      ctx.font = `${stroke.width * 3}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(stroke.text, stroke.position.x, stroke.position.y);
      return;
    }

    if (stroke.tool === "highlighter") {
      if (!stroke.points || stroke.points.length < 2) return;
      ctx.save();
      ctx.globalAlpha = highlighterAlpha * alpha;
      ctx.lineWidth = renderedWidth(stroke);
      ctx.lineCap = "butt";
      ctx.lineJoin = "round";
      buildFreehandPath(ctx, stroke.points);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (stroke.tool === "pen") {
      if (!stroke.points || stroke.points.length < 2) return;
      buildFreehandPath(ctx, stroke.points);
      ctx.stroke();
      return;
    }

    const start = stroke.start;
    const end = stroke.end;
    if (!start || !end) return;

    if (stroke.tool === "line") {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      return;
    }

    if (stroke.tool === "rectangle") {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      ctx.strokeRect(x, y, Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      return;
    }

    if (stroke.tool === "ellipse") {
      const cx = (start.x + end.x) / 2;
      const cy = (start.y + end.y) / 2;
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    if (stroke.tool === "arrow") {
      const headLength = Math.max(10, stroke.width * 3);
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLength * Math.cos(angle - Math.PI / 6),
        end.y - headLength * Math.sin(angle - Math.PI / 6),
      );
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLength * Math.cos(angle + Math.PI / 6),
        end.y - headLength * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
    }
  }, []);

  /**
   * Render committed strokes (plus fading ones): highlights to their own layer,
   * everything else to bg.
   */
  const renderLayers = useCallback(
    (strokes: Stroke[], hiddenId: string | null) => {
      hiddenIdRef.current = hiddenId;
      const bgCanvas = bgCanvasRef.current;
      const hlCanvas = hlCanvasRef.current;
      const bgCtx = getBgCtx();
      const hlCtx = hlCanvas?.getContext("2d") ?? null;
      if (!bgCanvas || !bgCtx || !hlCanvas || !hlCtx) return;
      clearFull(bgCanvas, bgCtx);
      clearFull(hlCanvas, hlCtx);
      for (const stroke of strokes) {
        if (hiddenId && stroke.id === hiddenId) continue;
        if (stroke.tool === "highlighter") drawStroke(hlCtx, stroke, 1);
        else drawStroke(bgCtx, stroke);
      }
      const now = performance.now();
      for (const { stroke, createdAt } of ephemeralRef.current) {
        const age = now - createdAt;
        const alpha = age <= FADE_HOLD_MS ? 1 : Math.max(0, 1 - (age - FADE_HOLD_MS) / FADE_OUT_MS);
        if (stroke.tool === "highlighter") drawStroke(hlCtx, stroke, 1, alpha);
        else drawStroke(bgCtx, stroke, HIGHLIGHTER_ALPHA, alpha);
      }
    },
    [drawStroke, getBgCtx],
  );

  const replayStrokes = useCallback(
    (strokes: Stroke[]) => renderLayers(strokes, null),
    [renderLayers],
  );

  const clearFg = useCallback(() => {
    const fg = fgCanvasRef.current;
    const ctx = getFgCtx();
    if (fg && ctx) clearFull(fg, ctx);
  }, [getFgCtx]);

  /** Push current strokes onto the undo stack, then apply `next`. */
  const commit = useCallback(
    (next: Stroke[]) => {
      pastRef.current.push(cloneStrokes(strokesRef.current));
      if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift();
      futureRef.current = [];
      strokesRef.current = next;
      replayStrokes(next);
    },
    [replayStrokes],
  );

  /** Animate fading strokes; the loop stops once none are left. */
  const runFadeLoop = useCallback(() => {
    if (fadeRafRef.current) return;
    const frame = () => {
      fadeRafRef.current = 0;
      const now = performance.now();
      ephemeralRef.current = ephemeralRef.current.filter(
        (e) => now - e.createdAt < FADE_HOLD_MS + FADE_OUT_MS,
      );
      renderLayers(strokesRef.current, hiddenIdRef.current);
      if (ephemeralRef.current.length) fadeRafRef.current = requestAnimationFrame(frame);
    };
    fadeRafRef.current = requestAnimationFrame(frame);
  }, [renderLayers]);

  useEffect(() => () => cancelAnimationFrame(fadeRafRef.current), []);

  /** Finished drawing gesture: permanent (undoable) or ephemeral in fade mode. */
  const addFinishedStroke = useCallback(
    (stroke: Stroke, ephemeral: boolean = fadeRef.current) => {
      if (ephemeral) {
        ephemeralRef.current.push({ stroke, createdAt: performance.now() });
        runFadeLoop();
      } else {
        commit([...strokesRef.current, stroke]);
      }
    },
    [commit, runFadeLoop],
  );

  /** Mutate strokes without a history entry (used mid-gesture). */
  const replaceLive = useCallback(
    (next: Stroke[]) => {
      strokesRef.current = next;
      replayStrokes(next);
    },
    [replayStrokes],
  );

  // Retina-aware resize
  useEffect(() => {
    const hlCanvas = hlCanvasRef.current;
    const bgCanvas = bgCanvasRef.current;
    const fgCanvas = fgCanvasRef.current;
    if (!hlCanvas || !bgCanvas || !fgCanvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of [hlCanvas, bgCanvas, fgCanvas]) {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.scale(dpr, dpr);
        }
      }
      replayStrokes(strokesRef.current);
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [replayStrokes]);

  // Pointer drawing (pen / highlighter / eraser / shapes)
  useEffect(() => {
    const fgCanvas = fgCanvasRef.current;
    if (!fgCanvas || !enabled) return;

    const eraseRadius = () => lineWidth * 3 + 12;
    let gestureFade = fadeRef.current;

    const eraseAtPoint = (pt: Point) => {
      const radius = eraseRadius();
      const prev = strokesRef.current;
      const next = prev.filter((s) => !strokeHitsPoint(s, pt, radius));
      if (next.length === prev.length) return;
      if (!eraseHistoryPushedRef.current) {
        pastRef.current.push(cloneStrokes(prev));
        if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift();
        futureRef.current = [];
        eraseHistoryPushedRef.current = true;
      }
      strokesRef.current = next;
      replayStrokes(next);
    };

    /** The eraser hides the system cursor, so this ring is the only pointer: draw it on hover too. */
    const drawEraserCursor = (fgCtx: CanvasRenderingContext2D, pt: Point) => {
      clearFull(fgCanvas, fgCtx);
      const r = eraseRadius();
      fgCtx.save();
      // Dark halo + light ring stays visible on both light and dark content
      fgCtx.beginPath();
      fgCtx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      fgCtx.strokeStyle = "rgba(0, 0, 0, 0.45)";
      fgCtx.lineWidth = 3.5;
      fgCtx.stroke();
      fgCtx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      fgCtx.lineWidth = 1.5;
      fgCtx.stroke();
      fgCtx.fillStyle = isDrawingRef.current ? "rgba(244, 63, 94, 0.18)" : "rgba(255, 255, 255, 0.08)";
      fgCtx.fill();
      // Center dot marks the exact pointer position
      fgCtx.beginPath();
      fgCtx.arc(pt.x, pt.y, 1.75, 0, Math.PI * 2);
      fgCtx.fillStyle = "rgba(255, 255, 255, 0.95)";
      fgCtx.fill();
      fgCtx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      fgCtx.lineWidth = 1;
      fgCtx.stroke();
      fgCtx.restore();
    };

    const paintLiveFreehand = (fgCtx: CanvasRenderingContext2D, points: Point[]) => {
      clearFull(fgCanvas, fgCtx);
      if (points.length < 2) return;
      drawStroke(fgCtx, {
        tool: tool as "pen" | "highlighter",
        color,
        width: lineWidth,
        points,
      });
    };

    const onDown = (e: PointerEvent) => {
      if (tool === "text") return;

      isDrawingRef.current = true;
      // Decide fade per gesture: fade may flip off before the gesture is finished
      // (e.g. releasing ⌥ in presenter mode ends quick-draw and its forced fade together)
      gestureFade = fadeRef.current;
      eraseHistoryPushedRef.current = false;
      fgCanvas.setPointerCapture(e.pointerId);
      const rect = fgCanvas.getBoundingClientRect();
      const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const fgCtx = getFgCtx();
      if (!fgCtx) return;

      if (tool === "eraser") {
        eraseAtPoint(pt);
        drawEraserCursor(fgCtx, pt);
        return;
      }

      if (tool === "pen" || tool === "highlighter") {
        currentPointsRef.current = [pt];
        previewStrokeRef.current = null;
        paintLiveFreehand(fgCtx, currentPointsRef.current);
        return;
      }

      // Shapes
      currentPointsRef.current = [];
      const endPt = e.shiftKey ? applyShiftConstraint(pt, pt, tool) : pt;
      previewStrokeRef.current = {
        id: newStrokeId("shape"),
        tool,
        color,
        width: lineWidth,
        start: pt,
        end: endPt,
      };
      clearFull(fgCanvas, fgCtx);
      drawStroke(fgCtx, previewStrokeRef.current);
    };

    const onMove = (e: PointerEvent) => {
      if (!isDrawingRef.current) {
        if (tool === "eraser") {
          const rect = fgCanvas.getBoundingClientRect();
          const fgCtx = getFgCtx();
          if (fgCtx) drawEraserCursor(fgCtx, { x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
        return;
      }
      const rect = fgCanvas.getBoundingClientRect();
      let pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const fgCtx = getFgCtx();
      if (!fgCtx) return;

      if (tool === "eraser") {
        eraseAtPoint(pt);
        drawEraserCursor(fgCtx, pt);
        return;
      }

      if (tool === "highlighter" && e.shiftKey && currentPointsRef.current.length) {
        // Straight marker line (snapped to 45°) for underlining text
        const start = currentPointsRef.current[0];
        currentPointsRef.current = [start, constrainTo45Degrees(start, pt)];
        paintLiveFreehand(fgCtx, currentPointsRef.current);
        return;
      }

      if (tool === "pen" || tool === "highlighter") {
        const pts = currentPointsRef.current;
        const last = pts[pts.length - 1];
        // Skip near-duplicates for smoother curves and less memory
        if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 1.5) return;
        pts.push(pt);
        paintLiveFreehand(fgCtx, pts);
        return;
      }

      if (previewStrokeRef.current?.start) {
        if (e.shiftKey) {
          pt = applyShiftConstraint(previewStrokeRef.current.start, pt, tool);
        }
        previewStrokeRef.current = { ...previewStrokeRef.current, end: pt };
        clearFull(fgCanvas, fgCtx);
        drawStroke(fgCtx, previewStrokeRef.current);
      }
    };

    /**
     * Finish the in-progress gesture. `end` is the release point when known; without it
     * (gesture interrupted) the last live preview position is used.
     */
    const finishGesture = (end?: Point, shiftKey = false) => {
      isDrawingRef.current = false;

      if (tool === "eraser") {
        eraseHistoryPushedRef.current = false;
        return;
      }

      if (tool === "pen" || tool === "highlighter") {
        const points = currentPointsRef.current;
        if (points.length > 1) {
          addFinishedStroke(
            {
              id: newStrokeId(tool),
              tool,
              points: [...points],
              color,
              width: lineWidth,
            },
            gestureFade,
          );
        }
      } else if (previewStrokeRef.current?.start) {
        const { start } = previewStrokeRef.current;
        let pt = end ?? previewStrokeRef.current.end ?? start;
        if (end && shiftKey) pt = applyShiftConstraint(start, pt, tool);
        if (Math.abs(pt.x - start.x) > 1 || Math.abs(pt.y - start.y) > 1) {
          addFinishedStroke({ ...previewStrokeRef.current, end: pt }, gestureFade);
        }
      }

      currentPointsRef.current = [];
      previewStrokeRef.current = null;
      clearFg();
    };

    const onUp = (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      const rect = fgCanvas.getBoundingClientRect();
      const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      finishGesture(pt, e.shiftKey);

      if (tool === "eraser") {
        // Keep showing the (idle) ring where the pointer is
        const fgCtx = getFgCtx();
        if (fgCtx) drawEraserCursor(fgCtx, pt);
      }
    };

    fgCanvas.addEventListener("pointerdown", onDown);
    fgCanvas.addEventListener("pointermove", onMove);
    fgCanvas.addEventListener("pointerup", onUp);
    fgCanvas.addEventListener("pointercancel", onUp);
    const onLeave = () => {
      if (tool === "eraser" && !isDrawingRef.current) clearFg();
    };
    fgCanvas.addEventListener("pointerleave", onLeave);
    return () => {
      // Drawing got disabled or the tool/style changed mid-gesture (e.g. ⌥ released
      // while dragging in presenter mode): commit what was drawn instead of leaving
      // a stuck preview and a half-open gesture.
      if (isDrawingRef.current) finishGesture();
      fgCanvas.removeEventListener("pointerleave", onLeave);
      // Don't leave a stale eraser ring behind when switching tools / leaving draw mode
      if (tool === "eraser") clearFg();
      fgCanvas.removeEventListener("pointerdown", onDown);
      fgCanvas.removeEventListener("pointermove", onMove);
      fgCanvas.removeEventListener("pointerup", onUp);
      fgCanvas.removeEventListener("pointercancel", onUp);
    };
  }, [enabled, color, lineWidth, tool, getFgCtx, drawStroke, replayStrokes, addFinishedStroke, clearFg]);

  const undo = useCallback(() => {
    if (!pastRef.current.length) return;
    const previous = pastRef.current.pop()!;
    futureRef.current.push(cloneStrokes(strokesRef.current));
    strokesRef.current = previous;
    replayStrokes(previous);
    clearFg();
  }, [replayStrokes, clearFg]);

  const redo = useCallback(() => {
    if (!futureRef.current.length) return;
    const next = futureRef.current.pop()!;
    pastRef.current.push(cloneStrokes(strokesRef.current));
    strokesRef.current = next;
    replayStrokes(next);
    clearFg();
  }, [replayStrokes, clearFg]);

  const clear = useCallback(() => {
    ephemeralRef.current = [];
    if (!strokesRef.current.length) {
      replayStrokes(strokesRef.current);
      clearFg();
      return;
    }
    commit([]);
    currentPointsRef.current = [];
    previewStrokeRef.current = null;
    clearFg();
  }, [commit, clearFg, replayStrokes]);

  const addTextStroke = useCallback(
    (text: string, position: Point, strokeColor: string, width: number): string => {
      const id = newStrokeId("text");
      commit([
        ...strokesRef.current,
        { id, tool: "text", text, position, color: strokeColor, width },
      ]);
      return id;
    },
    [commit],
  );

  const updateTextStroke = useCallback(
    (id: string, text: string, position?: Point) => {
      const next = strokesRef.current.map((s) =>
        s.id === id ? { ...s, text, ...(position ? { position } : {}) } : s,
      );
      commit(next);
    },
    [commit],
  );

  /** Live position update during drag (no history). */
  const previewMoveText = useCallback(
    (id: string, position: Point) => {
      replaceLive(
        strokesRef.current.map((s) => (s.id === id ? { ...s, position } : s)),
      );
    },
    [replaceLive],
  );

  /**
   * Finalize a text drag as one undo step.
   * `before` must be a clone of strokes taken at pointer-down.
   */
  const commitMoveText = useCallback(
    (before: Stroke[], id: string, position: Point) => {
      pastRef.current.push(cloneStrokes(before));
      if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift();
      futureRef.current = [];
      strokesRef.current = strokesRef.current.map((s) =>
        s.id === id ? { ...s, position } : s,
      );
      replayStrokes(strokesRef.current);
    },
    [replayStrokes],
  );

  const deleteStroke = useCallback(
    (id: string) => {
      const next = strokesRef.current.filter((s) => s.id !== id);
      if (next.length === strokesRef.current.length) return;
      commit(next);
    },
    [commit],
  );

  const findTextStrokeAt = useCallback(
    (pt: Point): Stroke | null => {
      const bgCtx = getBgCtx();
      if (!bgCtx) return null;
      for (let i = strokesRef.current.length - 1; i >= 0; i--) {
        const stroke = strokesRef.current[i];
        if (stroke.tool !== "text" || !stroke.text || !stroke.position) continue;
        bgCtx.font = `${stroke.width * 3}px system-ui, -apple-system, sans-serif`;
        bgCtx.textBaseline = "middle";
        const metrics = bgCtx.measureText(stroke.text);
        const fontH = stroke.width * 3.5;
        const pad = 6;
        const x1 = stroke.position.x - pad;
        const y1 = stroke.position.y - fontH / 2 - pad;
        const x2 = stroke.position.x + metrics.width + pad;
        const y2 = stroke.position.y + fontH / 2 + pad;
        if (pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2) return stroke;
      }
      return null;
    },
    [getBgCtx],
  );

  const getStrokesSnapshot = useCallback(() => cloneStrokes(strokesRef.current), []);

  /** Hide a stroke while its inline editor is open (avoids double-draw). */
  const setHiddenStrokeId = useCallback(
    (id: string | null) => renderLayers(strokesRef.current, id),
    [renderLayers],
  );

  return {
    hlCanvasRef,
    bgCanvasRef,
    fgCanvasRef,
    undo,
    redo,
    clear,
    addTextStroke,
    updateTextStroke,
    previewMoveText,
    commitMoveText,
    deleteStroke,
    findTextStrokeAt,
    getStrokesSnapshot,
    setHiddenStrokeId,
  };
}
