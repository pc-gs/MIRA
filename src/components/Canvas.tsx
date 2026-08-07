import { useEffect, useState, useCallback } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { useDrawing } from "../hooks/useDrawing";
import { Spotlight } from "./Spotlight";
import { TextInput } from "./TextInput";
import type { Tool } from "../types";

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

  const {
    bgCanvasRef,
    fgCanvasRef,
    undo,
    redo,
    clear,
    addTextStroke,
    updateTextStroke,
    deleteStroke,
    findTextStrokeAt,
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
          // Editing existing text stroke
          updateTextStroke(textInput.id, text, position);
        } else {
          // Creating new text stroke
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

  // Click handler for text tool creation or editing
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!drawingEnabled || tool !== "text") return;

    const rect = e.currentTarget.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    const clickedText = findTextStrokeAt(pt);

    if (clickedText && clickedText.id && clickedText.text && clickedText.position) {
      // Double click or single click existing text -> edit it!
      setTextInput({
        id: clickedText.id,
        x: clickedText.position.x,
        y: clickedText.position.y,
        color: clickedText.color,
        lineWidth: clickedText.width,
        initialText: clickedText.text,
      });
    } else {
      // Click on empty space -> new text!
      setTextInput({
        x: pt.x,
        y: pt.y,
        color,
        lineWidth,
        initialText: "",
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawingEnabled || tool !== "text" || textInput) {
      if (hoveredTextId) setHoveredTextId(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const hovered = findTextStrokeAt(pt);
    if (hovered?.id) {
      setHoveredTextId(hovered.id);
    } else if (hoveredTextId) {
      setHoveredTextId(null);
    }
  };

  useEffect(() => {
    // Request initial state from the toolbar in case this overlay spawned dynamically
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
    })();
    return () => subs.forEach((fn) => fn());
  }, [clear, undo, redo]);

  return (
    <div
      className="fixed inset-0 w-full h-full"
      style={{
        cursor: drawingEnabled
          ? tool === "text"
            ? hoveredTextId
              ? "pointer"
              : "text"
            : "crosshair"
          : "default",
      }}
      onClick={handleCanvasClick}
      onPointerMove={handlePointerMove}
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
