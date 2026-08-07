import { useEffect, useState, useCallback, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { useDrawing } from "../hooks/useDrawing";
import { Spotlight } from "./Spotlight";
import { TextInput } from "./TextInput";
import type { Tool, Point, Stroke } from "../types";

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
  const [spotlightEnabled, setSpotlightEnabled] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [textInput, setTextInput] = useState<ActiveTextInput | null>(null);
  const [hoverText, setHoverText] = useState(false);

  const textDragRef = useRef<TextDrag | null>(null);

  const {
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
    enabled: drawingEnabled && !textInput,
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
    if (!drawingEnabled || tool !== "text" || textInput) return;

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
    if (!drawingEnabled) {
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
    if (!drawingEnabled || tool !== "text") return;

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

  // Local undo when the overlay has focus (global shortcuts also fire via Rust)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
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
      await add<{ enabled: boolean }>("spotlight-toggled", (p) => setSpotlightEnabled(p.enabled));
      await add<{ x: number; y: number }>("cursor-moved", (p) => setCursor({ x: p.x, y: p.y }));

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
  }, [clear, undo, redo]);

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
      {spotlightEnabled && <Spotlight x={cursor.x} y={cursor.y} />}
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
