import { useRef, useCallback, useEffect } from "react";
import type { Stroke, Point, Tool } from "../types";

// Helper functions for Shift-key constraints
function constrainTo45Degrees(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Round to nearest 45° (π/4 radians)
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
    x: start.x + (dx > 0 ? maxDist : -maxDist),
    y: start.y + (dy > 0 ? maxDist : -maxDist),
  };
}

function applyShiftConstraint(start: Point, end: Point, tool: Tool): Point {
  if (tool === "line" || tool === "arrow") {
    return constrainTo45Degrees(start, end);
  }
  if (tool === "rectangle" || tool === "ellipse") {
    return constrainToSquare(start, end);
  }
  return end;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function strokeHitsPoint(stroke: Stroke, pt: Point, radius: number): boolean {
  if (stroke.tool === "pen" || stroke.tool === "highlighter") {
    if (!stroke.points) return false;
    for (let i = 0; i < stroke.points.length - 1; i++) {
      if (distanceToSegment(pt, stroke.points[i], stroke.points[i + 1]) <= radius) {
        return true;
      }
    }
    return false;
  }
  if (stroke.tool === "text" && stroke.position && stroke.text) {
    const fontH = stroke.width * 3.5;
    const approxW = stroke.text.length * (stroke.width * 2);
    const x1 = stroke.position.x - radius;
    const y1 = stroke.position.y - fontH / 2 - radius;
    const x2 = stroke.position.x + approxW + radius;
    const y2 = stroke.position.y + fontH / 2 + radius;
    return pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2;
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

interface UseDrawingOptions {
  color: string;
  lineWidth: number;
  enabled: boolean;
  tool: Tool;
}

export function useDrawing({
  color,
  lineWidth,
  enabled,
  tool,
}: UseDrawingOptions) {
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const redoStackRef = useRef<Stroke[]>([]);
  const currentPointsRef = useRef<Point[]>([]);
  const previewStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef(false);

  const getBgCtx = useCallback(
    () => bgCanvasRef.current?.getContext("2d") ?? null,
    [],
  );
  const getFgCtx = useCallback(
    () => fgCanvasRef.current?.getContext("2d") ?? null,
    [],
  );

  const drawStroke = useCallback(
    (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (stroke.tool === "text") {
        if (!stroke.text || !stroke.position) return;
        ctx.fillStyle = stroke.color;
        ctx.font = `${stroke.width * 3}px system-ui, -apple-system, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(stroke.text, stroke.position.x, stroke.position.y);
        return;
      }

      if (stroke.tool === "highlighter") {
        if (!stroke.points || stroke.points.length < 2) return;
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = stroke.width * 3.5;
        ctx.lineCap = "square";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

        if (stroke.points.length === 2) {
          ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
        } else {
          for (let i = 1; i < stroke.points.length - 1; i++) {
            const p1 = stroke.points[i];
            const p2 = stroke.points[i + 1];
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
          }
          const lastPt = stroke.points[stroke.points.length - 1];
          ctx.lineTo(lastPt.x, lastPt.y);
        }
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (stroke.tool === "pen") {
        if (!stroke.points || stroke.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

        if (stroke.points.length === 2) {
          ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
        } else {
          for (let i = 1; i < stroke.points.length - 1; i++) {
            const p1 = stroke.points[i];
            const p2 = stroke.points[i + 1];
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
          }
          const lastPt = stroke.points[stroke.points.length - 1];
          ctx.lineTo(lastPt.x, lastPt.y);
        }
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
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        ctx.strokeRect(x, y, w, h);
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
    },
    [],
  );

  const replayStrokes = useCallback(
    (strokes: Stroke[]) => {
      const bgCanvas = bgCanvasRef.current;
      const bgCtx = getBgCtx();
      if (!bgCanvas || !bgCtx) return;
      bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
      for (const stroke of strokes) {
        drawStroke(bgCtx, stroke);
      }
    },
    [drawStroke, getBgCtx],
  );

  // Resize canvas to window, applying DPR for crisp Retina rendering
  useEffect(() => {
    const bgCanvas = bgCanvasRef.current;
    const fgCanvas = fgCanvasRef.current;
    if (!bgCanvas || !fgCanvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      [bgCanvas, fgCanvas].forEach((canvas) => {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.scale(dpr, dpr);
      });
      replayStrokes(strokesRef.current);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [replayStrokes]);

  // Attach pointer listeners only when drawing is enabled
  useEffect(() => {
    const fgCanvas = fgCanvasRef.current;
    if (!fgCanvas || !enabled) return;

    const eraseAtPoint = (pt: Point) => {
      const radius = lineWidth * 3 + 12;
      const prevLen = strokesRef.current.length;
      strokesRef.current = strokesRef.current.filter((stroke) => !strokeHitsPoint(stroke, pt, radius));
      if (strokesRef.current.length !== prevLen) {
        replayStrokes(strokesRef.current);
      }
    };

    const drawEraserPreview = (fgCtx: CanvasRenderingContext2D, pt: Point) => {
      const radius = lineWidth * 3 + 12;
      fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
      fgCtx.save();
      fgCtx.beginPath();
      fgCtx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      fgCtx.strokeStyle = "#f43f5e";
      fgCtx.lineWidth = 2;
      fgCtx.setLineDash([4, 4]);
      fgCtx.stroke();
      fgCtx.restore();
    };

    const onDown = (e: PointerEvent) => {
      if (tool === "text") return;

      isDrawingRef.current = true;
      fgCanvas.setPointerCapture(e.pointerId);
      const rect = fgCanvas.getBoundingClientRect();
      const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const fgCtx = getFgCtx();
      if (!fgCtx) return;

      fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);

      if (tool === "eraser") {
        eraseAtPoint(pt);
        drawEraserPreview(fgCtx, pt);
      } else if (tool === "pen" || tool === "highlighter") {
        currentPointsRef.current = [pt];
        previewStrokeRef.current = null;
        fgCtx.beginPath();
        fgCtx.strokeStyle = color;
        fgCtx.lineWidth = tool === "highlighter" ? lineWidth * 3.5 : lineWidth;
        fgCtx.lineCap = tool === "highlighter" ? "square" : "round";
        fgCtx.lineJoin = "round";
        if (tool === "highlighter") fgCtx.globalAlpha = 0.45;
        fgCtx.moveTo(pt.x, pt.y);
      } else {
        currentPointsRef.current = [];
        const endPt = e.shiftKey ? applyShiftConstraint(pt, pt, tool) : pt;
        previewStrokeRef.current = {
          tool,
          color,
          width: lineWidth,
          start: pt,
          end: endPt,
        };
        drawStroke(fgCtx, previewStrokeRef.current);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      const rect = fgCanvas.getBoundingClientRect();
      let pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const fgCtx = getFgCtx();
      if (!fgCtx) return;

      if (tool === "eraser") {
        eraseAtPoint(pt);
        drawEraserPreview(fgCtx, pt);
      } else if (tool === "pen" || tool === "highlighter") {
        currentPointsRef.current.push(pt);
        fgCtx.lineTo(pt.x, pt.y);
        fgCtx.stroke();
      } else if (previewStrokeRef.current?.start) {
        if (e.shiftKey) {
          pt = applyShiftConstraint(previewStrokeRef.current.start, pt, tool);
        }
        previewStrokeRef.current = {
          ...previewStrokeRef.current,
          end: pt,
        };
        fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
        drawStroke(fgCtx, previewStrokeRef.current);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;

      let addedStroke = false;
      if (tool === "pen" || tool === "highlighter") {
        const points = [...currentPointsRef.current];
        if (points.length > 1) {
          strokesRef.current = [
            ...strokesRef.current,
            { tool, points, color, width: lineWidth },
          ];
          addedStroke = true;
        }
      } else if (tool !== "eraser" && previewStrokeRef.current?.start && previewStrokeRef.current.end) {
        const rect = fgCanvas.getBoundingClientRect();
        let pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        if (e.shiftKey) {
          pt = applyShiftConstraint(previewStrokeRef.current.start, pt, tool);
        }
        const { start } = previewStrokeRef.current;
        if (
          Math.abs(pt.x - start.x) > 0.5 ||
          Math.abs(pt.y - start.y) > 0.5
        ) {
          strokesRef.current = [
            ...strokesRef.current,
            { ...previewStrokeRef.current, end: pt },
          ];
          addedStroke = true;
        }
      }

      redoStackRef.current = []; // clear redo on new stroke
      currentPointsRef.current = [];
      previewStrokeRef.current = null;

      const fgCtx = getFgCtx();
      if (fgCtx && fgCanvasRef.current) {
        fgCtx.clearRect(
          0,
          0,
          fgCanvasRef.current.width,
          fgCanvasRef.current.height,
        );
      }

      if (addedStroke) {
        // Ensure the last stroke has a unique ID
        const lastIndex = strokesRef.current.length - 1;
        if (lastIndex >= 0 && !strokesRef.current[lastIndex].id) {
          strokesRef.current[lastIndex].id = `stroke_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        }
        // Redraw on background only once per final stroke
        replayStrokes(strokesRef.current);
      }
    };

    fgCanvas.addEventListener("pointerdown", onDown);
    fgCanvas.addEventListener("pointermove", onMove);
    fgCanvas.addEventListener("pointerup", onUp);
    fgCanvas.addEventListener("pointercancel", onUp);
    return () => {
      fgCanvas.removeEventListener("pointerdown", onDown);
      fgCanvas.removeEventListener("pointermove", onMove);
      fgCanvas.removeEventListener("pointerup", onUp);
      fgCanvas.removeEventListener("pointercancel", onUp);
    };
  }, [enabled, color, lineWidth, tool, getFgCtx, drawStroke, replayStrokes]);

  const undo = useCallback(() => {
    if (!strokesRef.current.length) return;
    const last = strokesRef.current[strokesRef.current.length - 1]!;
    redoStackRef.current = [...redoStackRef.current, last];
    strokesRef.current = strokesRef.current.slice(0, -1);
    replayStrokes(strokesRef.current);
  }, [replayStrokes]);

  const redo = useCallback(() => {
    if (!redoStackRef.current.length) return;
    const next = redoStackRef.current[redoStackRef.current.length - 1]!;
    strokesRef.current = [...strokesRef.current, next];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    replayStrokes(strokesRef.current);
  }, [replayStrokes]);

  const clear = useCallback(() => {
    strokesRef.current = [];
    redoStackRef.current = [];
    currentPointsRef.current = [];
    previewStrokeRef.current = null;

    const bgCanvas = bgCanvasRef.current;
    const bgCtx = getBgCtx();
    if (bgCanvas && bgCtx)
      bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

    const fgCanvas = fgCanvasRef.current;
    const fgCtx = getFgCtx();
    if (fgCanvas && fgCtx)
      fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
  }, [getBgCtx, getFgCtx]);

  const addTextStroke = useCallback(
    (text: string, position: Point, color: string, width: number): string => {
      const id = `text_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      strokesRef.current = [
        ...strokesRef.current,
        { id, tool: "text", text, position, color, width },
      ];
      replayStrokes(strokesRef.current);
      return id;
    },
    [replayStrokes],
  );

  const updateTextStroke = useCallback(
    (id: string, text: string, position?: Point) => {
      strokesRef.current = strokesRef.current.map((s) => {
        if (s.id === id) {
          return { ...s, text, ...(position ? { position } : {}) };
        }
        return s;
      });
      replayStrokes(strokesRef.current);
    },
    [replayStrokes],
  );

  const moveTextStroke = useCallback(
    (id: string, newPosition: Point) => {
      strokesRef.current = strokesRef.current.map((s) => {
        if (s.id === id) {
          return { ...s, position: newPosition };
        }
        return s;
      });
      replayStrokes(strokesRef.current);
    },
    [replayStrokes],
  );

  const deleteStroke = useCallback(
    (id: string) => {
      strokesRef.current = strokesRef.current.filter((s) => s.id !== id);
      replayStrokes(strokesRef.current);
    },
    [replayStrokes],
  );

  const findTextStrokeAt = useCallback(
    (pt: Point): Stroke | null => {
      const bgCtx = getBgCtx();
      if (!bgCtx) return null;
      for (let i = strokesRef.current.length - 1; i >= 0; i--) {
        const stroke = strokesRef.current[i];
        if (stroke.tool === "text" && stroke.text && stroke.position) {
          bgCtx.font = `${stroke.width * 3}px system-ui, -apple-system, sans-serif`;
          bgCtx.textBaseline = "middle";
          const metrics = bgCtx.measureText(stroke.text);
          const fontH = stroke.width * 3.5;
          const x1 = stroke.position.x - 4;
          const y1 = stroke.position.y - fontH / 2 - 4;
          const x2 = stroke.position.x + metrics.width + 4;
          const y2 = stroke.position.y + fontH / 2 + 4;

          if (pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2) {
            return stroke;
          }
        }
      }
      return null;
    },
    [getBgCtx],
  );

  const getStrokes = useCallback(() => strokesRef.current, []);

  return {
    bgCanvasRef,
    fgCanvasRef,
    undo,
    redo,
    clear,
    addTextStroke,
    updateTextStroke,
    moveTextStroke,
    deleteStroke,
    findTextStrokeAt,
    getStrokes,
    replayStrokes,
  };
}
