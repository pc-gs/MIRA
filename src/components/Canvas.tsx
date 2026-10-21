import { useEffect, useState, useCallback, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { useDrawing, HIGHLIGHTER_ALPHA } from "../hooks/useDrawing";
import { useCursorStream, isInsideWindow } from "../hooks/useCursorStream";
import { Spotlight } from "./Spotlight";
import { LaserPointer } from "./LaserPointer";
import { ZoomView } from "./ZoomView";
import { TextInput } from "./TextInput";
import type { Tool, Point, Stroke, PointerMode } from "../types";

// Classic red laser: stays visible on light and dark slides regardless of pen color
const LASER_COLOR = "#ff2d2d";

interface ActiveTextInput {
  id?: string;
  x: number;
  y: number;
  color: string;
  lineWidth: number;
  initialText: string;
}

interface TextDrag {
  id: string;
  startMouse: Point;
  startPos: Point;
  color: string;
  width: number;
  text: string;
  before: Stroke[];
  moved: boolean;
}

export function Canvas() {
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#ffffff");
  const [lineWidth, setLineWidth] = useState(6);
  const [pointerMode, setPointerMode] = useState<PointerMode>("off");
  const [textInput, setTextInput] = useState<ActiveTextInput | null>(null);
  const [hoverText, setHoverText] = useState(false);
  const [zoomActive, setZoomActive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const textDragRef = useRef<TextDrag | null>(null);
  const cursor = useCursorStream();

  const drawingEnabledRef = useRef(drawingEnabled);
  drawingEnabledRef.current = drawingEnabled;
  const zoomActiveRef = useRef(zoomActive);
  zoomActiveRef.current = zoomActive;

  const {
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
  } = useDrawing({
    color,
    lineWidth,
    enabled: drawingEnabled && !textInput && !zoomActive,
    tool,
  });

  // While editing, hide the underlying stroke so the input is the only visible text
  useEffect(() => {
    setHiddenStrokeId(textInput?.id ?? null);
    return () => setHiddenStrokeId(null);
  }, [textInput?.id, setHiddenStrokeId]);

  const handleTextSubmit = useCallback(
    (text: string) => {
      if (!textInput) return;
      if (textInput.id) {
        updateTextStroke(textInput.id, text, { x: textInput.x, y: textInput.y });
      } else {
        addTextStroke(text, { x: textInput.x, y: textInput.y }, textInput.color, textInput.lineWidth);
      }
      setTextInput(null);
    },
    [textInput, addTextStroke, updateTextStroke],
  );

  const handleTextCancel = useCallback(() => setTextInput(null), []);

  const handleTextDelete = useCallback(() => {
    if (textInput?.id) deleteStroke(textInput.id);
    setTextInput(null);
  }, [textInput, deleteStroke]);

  const pointFromEvent = (e: React.PointerEvent | React.MouseEvent): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Text tool: create / edit / drag. Other tools leave drawing to useDrawing.
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!drawingEnabled || tool !== "text" || textInput || zoomActive) return;

    const pt = pointFromEvent(e);
    const hit = findTextStrokeAt(pt);

    if (hit?.id && hit.position && hit.text) {
      e.stopPropagation();
      textDragRef.current = {
        id: hit.id,
        startMouse: pt,
        startPos: { ...hit.position },
        color: hit.color,
        width: hit.width,
        text: hit.text,
        before: getStrokesSnapshot(),
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawingEnabled || zoomActive) {
      if (hoverText) setHoverText(false);
      return;
    }

    const pt = pointFromEvent(e);

    if (textDragRef.current) {
      const drag = textDragRef.current;
      const dx = pt.x - drag.startMouse.x;
      const dy = pt.y - drag.startMouse.y;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      previewMoveText(drag.id, {
        x: drag.startPos.x + dx,
        y: drag.startPos.y + dy,
      });
      return;
    }

    if (tool === "text" && !textInput) {
      setHoverText(!!findTextStrokeAt(pt));
    } else if (hoverText) {
      setHoverText(false);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drawingEnabled || tool !== "text" || zoomActive) return;

    const pt = pointFromEvent(e);

    if (textDragRef.current) {
      const drag = textDragRef.current;
      textDragRef.current = null;

      if (drag.moved) {
        const finalPos = {
          x: drag.startPos.x + (pt.x - drag.startMouse.x),
          y: drag.startPos.y + (pt.y - drag.startMouse.y),
        };
        commitMoveText(drag.before, drag.id, finalPos);
      } else {
        // Click without drag → edit in place
        setTextInput({
          id: drag.id,
          x: drag.startPos.x,
          y: drag.startPos.y,
          color: drag.color,
          lineWidth: drag.width,
          initialText: drag.text,
        });
      }
      return;
    }

    if (textInput) return;

    // Empty click → new text
    if (!findTextStrokeAt(pt)) {
      setTextInput({
        x: pt.x,
        y: pt.y,
        color,
        lineWidth,
        initialText: "",
      });
    }
  };

  // Local keys when the overlay has focus (global shortcuts also fire via Rust)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (zoomActiveRef.current) return; // ZoomView handles its own keys

      if (e.key === "Escape" && drawingEnabledRef.current) {
        // Toolbar owns draw mode; ask it to switch back to click-through
        e.preventDefault();
        void emit("overlay-escape");
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  useEffect(() => {
    void emit("request-state");
  }, []);

  useEffect(() => {
    const subs: Array<() => void> = [];
    let cancelled = false;

    (async () => {
      const add = async <T,>(event: string, handler: (payload: T) => void) => {
        const unlisten = await listen<T>(event, (e) => handler(e.payload));
        if (cancelled) unlisten();
        else subs.push(unlisten);
      };

      await add<{ enabled: boolean }>("drawing-toggled", (p) => setDrawingEnabled(p.enabled));
      await add<{ tool: Tool }>("tool-changed", (p) => setTool(p.tool));
      await add<{ color: string }>("color-changed", (p) => setColor(p.color));
      await add<{ size: number }>("size-changed", (p) => setLineWidth(p.size));
      await add<{ mode: PointerMode }>("pointer-mode-changed", (p) => setPointerMode(p.mode));
      await add<null>("zoom-toggle", () => {
        if (zoomActiveRef.current) {
          setZoomActive(false);
          return;
        }
        // Only the overlay on the cursor's monitor zooms
        const pos = cursor.get();
        if (pos && isInsideWindow(pos)) {
          setTextInput(null);
          setZoomActive(true);
        }
      });

      const uClear = await listen("shortcut-clear", () => clear());
      const uUndo = await listen("shortcut-undo", () => undo());
      const uRedo = await listen("shortcut-redo", () => redo());
      if (cancelled) {
        uClear();
        uUndo();
        uRedo();
      } else {
        subs.push(uClear, uUndo, uRedo);
      }
    })();

    return () => {
      cancelled = true;
      subs.forEach((fn) => fn());
    };
  }, [clear, undo, redo, cursor]);

  const exitZoom = useCallback(() => setZoomActive(false), []);
  const getPassThrough = useCallback(() => !drawingEnabledRef.current, []);
  const handleZoomError = useCallback((message: string) => {
    setZoomActive(false);
    setNotice(message);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  const cursorStyle = !drawingEnabled
    ? "default"
    : tool === "text"
      ? hoverText
        ? "grab"
        : "text"
      : tool === "eraser"
        ? "none"
        : "crosshair";

  return (
    <div
      className="fixed inset-0 w-full h-full"
      style={{ cursor: cursorStyle }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <canvas
        ref={hlCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ opacity: HIGHLIGHTER_ALPHA }}
      />
      <canvas
        ref={bgCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
      <canvas
        ref={fgCanvasRef}
        className="absolute inset-0 w-full h-full"
        style={{
          touchAction: "none",
          // Text interactions are handled on the parent; avoid double-handling
          pointerEvents: tool === "text" ? "none" : "auto",
        }}
      />
      {pointerMode === "spotlight" && <Spotlight cursor={cursor} />}
      {pointerMode === "laser" && !zoomActive && <LaserPointer cursor={cursor} color={LASER_COLOR} />}
      {zoomActive && (
        <ZoomView
          initialCursor={cursor.get()}
          color={color}
          lineWidth={lineWidth}
          getPassThrough={getPassThrough}
          onExit={exitZoom}
          onError={handleZoomError}
        />
      )}
      {notice && (
        <div className="pointer-events-none fixed top-6 left-1/2 -translate-x-1/2 max-w-md px-4 py-2 rounded-lg bg-neutral-900/90 text-white text-sm shadow-xl">
          {notice}
        </div>
      )}
      {textInput && (
        <TextInput
          x={textInput.x}
          y={textInput.y}
          color={textInput.color}
          fontSize={textInput.lineWidth}
          initialText={textInput.initialText}
          onSubmit={handleTextSubmit}
          onCancel={handleTextCancel}
          onDelete={textInput.id ? handleTextDelete : undefined}
        />
      )}
    </div>
  );
}
