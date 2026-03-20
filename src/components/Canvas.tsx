import { useEffect, useState } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { useDrawing } from "../hooks/useDrawing";
import { Spotlight } from "./Spotlight";
import { TextInput } from "./TextInput";
import type { Tool } from "../types";

export function Canvas() {
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#ffffff");
  const [lineWidth, setLineWidth] = useState(6);
  const [spotlightEnabled, setSpotlightEnabled] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });

  const { bgCanvasRef, fgCanvasRef, undo, redo, clear } = useDrawing({
    color,
    lineWidth,
    enabled: drawingEnabled,
    tool,
  });

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
      style={{ cursor: drawingEnabled ? "crosshair" : "default" }}
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
          onSubmit={handleTextSubmit}
          onCancel={handleTextCancel}
        />
      )}
    </div>
  );
}
