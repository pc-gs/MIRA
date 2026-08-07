import { useEffect, useState, useCallback, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { useDrawing } from "../hooks/useDrawing";
import { Spotlight } from "./Spotlight";
import { TextInput } from "./TextInput";
import type { Tool, Point, Stroke } from "../types";

interface ActiveTextInputState {
  id?: string;
  x: number;
  y: number;
  color: string;
  lineWidth: number;
  initialText: string;
}

export function Canvas() {
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#ffffff");
  const [lineWidth, setLineWidth] = useState(6);
  const [spotlightEnabled, setSpotlightEnabled] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [textInput, setTextInput] = useState<ActiveTextInputState | null>(null);
  const [hoveredTextId, setHoveredTextId] = useState<string | null>(null);

  // Ref for tracking active text drag
  const textDragRef = useRef<{
    strokeId: string;
    stroke: Stroke;
    startMouse: Point;
    startPos: Point;
    hasDragged: boolean;
  } | null>(null);

  const {
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
    exportScreenshot,
  } = useDrawing({
    color,
    lineWidth,
    enabled: drawingEnabled,
    tool,
  });

  const handleTextSubmit = useCallback(
    (text: string, position: { x: number; y: number }) => {
      if (textInput) {
        if (textInput.id) {
          updateTextStroke(textInput.id, text, position);
        } else {
          addTextStroke(text, position, textInput.color, textInput.lineWidth);
        }
      }
      setTextInput(null);
    },
    [textInput, addTextStroke, updateTextStroke],
  );

  const handleTextCancel = useCallback(() => {
    setTextInput(null);
  }, []);

  const handleTextDelete = useCallback(() => {
    if (textInput?.id) {
      deleteStroke(textInput.id);
    }
    setTextInput(null);
  }, [textInput, deleteStroke]);

  // Pointer Down for Canvas (handles direct text drag and text editing)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!drawingEnabled) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    const clickedText = findTextStrokeAt(pt);

    if (clickedText && clickedText.id && clickedText.position) {
      // Start text dragging session
      textDragRef.current = {
        strokeId: clickedText.id,
        stroke: clickedText,
        startMouse: pt,
        startPos: { ...clickedText.position },
        hasDragged: false,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawingEnabled) {
      if (hoveredTextId) setHoveredTextId(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    // If currently dragging a text object
    if (textDragRef.current) {
      const dx = pt.x - textDragRef.current.startMouse.x;
      const dy = pt.y - textDragRef.current.startMouse.y;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        textDragRef.current.hasDragged = true;
      }

      const newPos = {
        x: textDragRef.current.startPos.x + dx,
        y: textDragRef.current.startPos.y + dy,
      };

      moveTextStroke(textDragRef.current.strokeId, newPos);
      return;
    }

    // Hover state check
    const hovered = findTextStrokeAt(pt);
    if (hovered?.id) {
      setHoveredTextId(hovered.id);
    } else if (hoveredTextId) {
      setHoveredTextId(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drawingEnabled) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (textDragRef.current) {
      const { stroke, hasDragged } = textDragRef.current;
      textDragRef.current = null;

      // If user clicked without dragging (or in text tool mode), open inline editor!
      if (!hasDragged && stroke.id && stroke.text && stroke.position) {
        setTextInput({
          id: stroke.id,
          x: stroke.position.x,
          y: stroke.position.y,
          color: stroke.color,
          lineWidth: stroke.width,
          initialText: stroke.text,
        });
      }
      return;
    }

    // Click on empty space in text tool mode -> create new text
    if (tool === "text" && !textInput) {
      const clickedText = findTextStrokeAt(pt);
      if (!clickedText) {
        setTextInput({
          x: pt.x,
          y: pt.y,
          color,
          lineWidth,
          initialText: "",
        });
      }
    }
  };

  // Keyboard listeners for Cmd+Z / Cmd+Shift+Z / Cmd+Y
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing inside an input field
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  useEffect(() => {
    // Request initial state from toolbar
    void emit("request-state");
  }, []);

  useEffect(() => {
    const subs: Array<() => void> = [];
    (async () => {
      subs.push(
        await listen<{ enabled: boolean }>("drawing-toggled", (e) =>
          setDrawingEnabled(e.payload.enabled),
        ),
      );
      subs.push(
        await listen<{ tool: Tool }>("tool-changed", (e) =>
          setTool(e.payload.tool),
        ),
      );
      subs.push(
        await listen<{ color: string }>("color-changed", (e) =>
          setColor(e.payload.color),
        ),
      );
      subs.push(
        await listen<{ size: number }>("size-changed", (e) =>
          setLineWidth(e.payload.size),
        ),
      );
      subs.push(
        await listen<{ enabled: boolean }>("spotlight-toggled", (e) =>
          setSpotlightEnabled(e.payload.enabled),
        ),
      );
      subs.push(
        await listen<{ x: number; y: number }>("cursor-moved", (e) =>
          setCursor({ x: e.payload.x, y: e.payload.y }),
        ),
      );
      subs.push(await listen("shortcut-clear", () => clear()));
      subs.push(await listen("shortcut-undo", () => undo()));
      subs.push(await listen("shortcut-redo", () => redo()));
      subs.push(
        await listen("request-screenshot", async () => {
          const ok = await exportScreenshot();
          void emit("screenshot-result", { success: ok });
        }),
      );
    })();
    return () => subs.forEach((fn) => fn());
  }, [clear, undo, redo]);

  return (
    <div
      className="fixed inset-0 w-full h-full"
      style={{
        cursor: drawingEnabled
          ? hoveredTextId
            ? "grab"
            : tool === "text"
            ? "text"
            : "crosshair"
          : "default",
      }}
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
        style={{ touchAction: "none" }}
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
