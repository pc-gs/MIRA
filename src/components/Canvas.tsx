import { useEffect, useState, useCallback, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { useDrawing, HIGHLIGHTER_ALPHA } from "../hooks/useDrawing";
import { useCursorStream, isInsideWindow } from "../hooks/useCursorStream";
import { Spotlight } from "./Spotlight";
import { LaserPointer } from "./LaserPointer";
import { ZoomView } from "./ZoomView";
import { TextInput } from "./TextInput";
import { CursorHalo } from "./CursorHalo";
import { ClickRipples } from "./ClickRipples";
import { BrushCursor } from "./BrushCursor";
import { ShortcutSheet, ShortcutHint } from "./ShortcutSheet";
import { drawCommandForKey, SPRING_TOOLS } from "../lib/drawKeys";
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

/** A tool key held down: its tool is used while held, a plain tap switches tools for good. */
interface SpringKey {
  key: string;
  tool: Tool;
  used: boolean;
}

// The "? for shortcuts" pill only shows the first few times draw mode turns on
const HINT_SHOWS = 3;
const HINT_MS = 2600;
let hintsShown = 0;

export function Canvas() {
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#ffffff");
  const [lineWidth, setLineWidth] = useState(6);
  const [pointerMode, setPointerMode] = useState<PointerMode>("off");
  const [fadeEnabled, setFadeEnabled] = useState(false);
  const [presenterMode, setPresenterMode] = useState(false);
  // ⌥ held in presenter mode: Rust turned off click-through so this overlay can draw
  const [quickDrawRaw, setQuickDraw] = useState(false);
  const [textInput, setTextInput] = useState<ActiveTextInput | null>(null);
  const [hoverText, setHoverText] = useState(false);
  const [zoomActive, setZoomActive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [springTool, setSpringTool] = useState<Tool | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const springRef = useRef<SpringKey | null>(null);

  const textDragRef = useRef<TextDrag | null>(null);
  const cursor = useCursorStream();

  const drawingEnabledRef = useRef(drawingEnabled);
  drawingEnabledRef.current = drawingEnabled;
  const zoomActiveRef = useRef(zoomActive);
  zoomActiveRef.current = zoomActive;
  const helpOpenRef = useRef(helpOpen);
  helpOpenRef.current = helpOpen;

  // Quick-draw only counts in presenter mode and when regular draw mode is off
  const quickDraw = presenterMode && quickDrawRaw && !drawingEnabled;
  const drawingActive = drawingEnabled || quickDraw;
  // A held tool key (draw mode only) overrides the selected tool
  const activeTool: Tool = (drawingEnabled && springTool) || tool;
  // Quick-draw marks with ink tools; eraser/text fall back to the pen
  const effectiveTool: Tool =
    quickDraw && (activeTool === "eraser" || activeTool === "text") ? "pen" : activeTool;

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
    enabled: drawingActive && !textInput && !zoomActive && !helpOpen,
    tool: effectiveTool,
    // Presenter marks always fade so the content stays clean
    fade: fadeEnabled || quickDraw,
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
    if (!drawingEnabled || activeTool !== "text" || textInput || zoomActive) return;

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

    if (activeTool === "text" && !textInput) {
      setHoverText(!!findTextStrokeAt(pt));
    } else if (hoverText) {
      setHoverText(false);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drawingEnabled || activeTool !== "text" || zoomActive) return;

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
    const endSpring = () => {
      springRef.current = null;
      setSpringTool(null);
    };

    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (zoomActiveRef.current) return; // ZoomView handles its own keys

      if (e.key === "Escape" && helpOpenRef.current) {
        e.preventDefault();
        setHelpOpen(false);
      } else if (e.key === "Escape" && drawingEnabledRef.current) {
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
      } else if (drawingEnabledRef.current) {
        const cmd = drawCommandForKey(e);
        if (!cmd) return;
        e.preventDefault();
        if (e.repeat) return;
        if (cmd.kind === "help") {
          setHelpOpen((open) => !open);
          return;
        }
        const letter = e.key.toLowerCase();
        if (cmd.kind === "tool" && SPRING_TOOLS[letter]) {
          // Decided on key up: dragged while held → temporary, plain tap → switch tools
          springRef.current = { key: letter, tool: cmd.tool, used: false };
          setSpringTool(cmd.tool);
          return;
        }
        void emit("overlay-command", cmd);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const spring = springRef.current;
      if (!spring || e.key.toLowerCase() !== spring.key) return;
      endSpring();
      if (!spring.used) void emit("overlay-command", { kind: "tool", tool: spring.tool });
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    // Key up is lost if focus leaves while the key is held
    window.addEventListener("blur", endSpring);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", endSpring);
    };
  }, [undo, redo]);

  // Leaving draw mode drops a held tool key and the cheat sheet
  useEffect(() => {
    if (drawingEnabled) return;
    springRef.current = null;
    setSpringTool(null);
    setHelpOpen(false);
  }, [drawingEnabled]);

  // Remind about "?" the first few times draw mode turns on, on the cursor's monitor
  useEffect(() => {
    if (!drawingEnabled || hintsShown >= HINT_SHOWS) return;
    const pos = cursor.get();
    if (pos && !isInsideWindow(pos)) return;
    hintsShown += 1;
    setHintVisible(true);
    const id = setTimeout(() => setHintVisible(false), HINT_MS);
    return () => {
      clearTimeout(id);
      setHintVisible(false);
    };
  }, [drawingEnabled, cursor]);

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
      await add<{ enabled: boolean }>("fade-mode-changed", (p) => setFadeEnabled(p.enabled));
      await add<{ enabled: boolean }>("presenter-mode-changed", (p) => {
        setPresenterMode(p.enabled);
        if (!p.enabled) setQuickDraw(false);
      });
      await add<{ active: boolean }>("quick-draw", (p) => setQuickDraw(p.active));
      await add<null>("help-toggle", () => {
        // Toolbar-initiated ("?" with the toolbar focused): show it where the cursor is
        const pos = cursor.get();
        if (!drawingEnabledRef.current || (pos && !isInsideWindow(pos))) return;
        setHelpOpen((open) => !open);
      });
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

  // Ink tools get a dot in the stroke's color and size instead of the system cursor
  const showBrushCursor =
    drawingEnabled &&
    !textInput &&
    !zoomActive &&
    !helpOpen &&
    activeTool !== "eraser" &&
    activeTool !== "text";

  const cursorStyle = quickDraw
    ? "crosshair"
    : !drawingEnabled
    ? "default"
    : helpOpen
      ? "default"
      : activeTool === "text"
        ? hoverText
          ? "grab"
          : "text"
        : "none";

  return (
    <div
      className="fixed inset-0 w-full h-full"
      style={{ cursor: cursorStyle }}
      onPointerDownCapture={() => {
        if (springRef.current) springRef.current.used = true;
      }}
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
          pointerEvents: effectiveTool === "text" ? "none" : "auto",
        }}
      />
      {pointerMode === "spotlight" && <Spotlight cursor={cursor} />}
      {pointerMode === "laser" && !zoomActive && <LaserPointer cursor={cursor} color={LASER_COLOR} />}
      {presenterMode && pointerMode === "off" && !zoomActive && (
        <CursorHalo cursor={cursor} drawing={quickDraw} inkColor={color} />
      )}
      {presenterMode && !zoomActive && <ClickRipples />}
      {showBrushCursor && (
        <BrushCursor cursor={cursor} tool={activeTool} color={color} lineWidth={lineWidth} />
      )}
      {helpOpen && <ShortcutSheet onClose={() => setHelpOpen(false)} />}
      {hintVisible && !helpOpen && <ShortcutHint />}
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
        <div
          className="pointer-events-none fixed top-8 left-1/2 -translate-x-1/2 max-w-lg flex items-start gap-3 px-4 py-3 rounded-2xl text-[13px] leading-snug text-zinc-100"
          style={{
            background: "rgba(24,24,27,0.88)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1), 0 16px 40px -10px rgba(0,0,0,0.6)",
            backdropFilter: "blur(14px)",
            fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          }}
        >
          <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-amber-400 text-zinc-900 text-[11px] font-bold flex items-center justify-center">
            !
          </span>
          <span>{notice}</span>
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
