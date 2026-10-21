import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Tool, PointerMode } from "../types";
import { PRESET_COLORS, PEN_SIZES, DEFAULT_HIGHLIGHTER_COLOR } from "../types";

// Compact, presentation-friendly widths (no fake modals / extra chrome)
const TOOLBAR_WIDTH_BASE = 660;
const TOOLBAR_WIDTH_TOOLS_DELTA = 96;
const TOOLBAR_WIDTH_COLORS_DELTA = 104;
const SHAPE_TOOLS: Tool[] = ["line", "rectangle", "ellipse", "arrow", "text"];

export function Toolbar() {
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [currentTool, setCurrentTool] = useState<Tool>("pen");
  const [currentShapeTool, setCurrentShapeTool] = useState<Tool>("line");
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [pointerMode, setPointerMode] = useState<PointerMode>("off");
  // Highlighter keeps its own color so switching tools doesn't turn it white
  const [penColor, setPenColor] = useState<string>(PRESET_COLORS[0]);
  const [highlighterColor, setHighlighterColor] = useState<string>(DEFAULT_HIGHLIGHTER_COLOR);
  const currentColor = currentTool === "highlighter" ? highlighterColor : penColor;
  const [currentSize, setCurrentSize] = useState<number>(6);
  const [colorsExpanded, setColorsExpanded] = useState(false);

  // Refs so shortcut listeners always see latest state without re-subscribing
  const overlayVisibleRef = useRef(overlayVisible);
  const drawingEnabledRef = useRef(drawingEnabled);
  const pointerModeRef = useRef(pointerMode);
  const currentToolRef = useRef(currentTool);
  currentToolRef.current = currentTool;
  const colorsRef = useRef({ penColor, highlighterColor });
  colorsRef.current = { penColor, highlighterColor };
  useEffect(() => {
    overlayVisibleRef.current = overlayVisible;
  }, [overlayVisible]);
  useEffect(() => {
    drawingEnabledRef.current = drawingEnabled;
  }, [drawingEnabled]);
  useEffect(() => {
    pointerModeRef.current = pointerMode;
  }, [pointerMode]);

  const applyOverlayVisible = useCallback(async (visible: boolean) => {
    setOverlayVisible(visible);
    await invoke("set_overlay_visible", { visible });
    if (!visible) {
      setDrawingEnabled(false);
      await invoke("set_overlay_passthrough", { passThrough: true });
    }
  }, []);

  const applyDrawingEnabled = useCallback(async (enabled: boolean) => {
    setDrawingEnabled(enabled);
    await invoke("emit_to_overlay", { event: "drawing-toggled", payload: { enabled } });
    await invoke("set_overlay_passthrough", { passThrough: !enabled });
  }, []);

  const applyColor = useCallback(async (color: string) => {
    if (currentToolRef.current === "highlighter") setHighlighterColor(color);
    else setPenColor(color);
    setColorsExpanded(false);
    await invoke("emit_to_overlay", { event: "color-changed", payload: { color } });
  }, []);

  const applySize = useCallback(async (size: number) => {
    setCurrentSize(size);
    await invoke("emit_to_overlay", { event: "size-changed", payload: { size } });
  }, []);

  const applyPointerMode = useCallback(
    async (mode: PointerMode) => {
      setPointerMode(mode);
      pointerModeRef.current = mode;
      // Laser is for pointing at other apps, so clicks must pass through
      if (mode === "laser" && drawingEnabledRef.current) await applyDrawingEnabled(false);
      await invoke("emit_to_overlay", { event: "pointer-mode-changed", payload: { mode } });
    },
    [applyDrawingEnabled],
  );

  const togglePointerMode = useCallback(
    (mode: PointerMode) => applyPointerMode(pointerModeRef.current === mode ? "off" : mode),
    [applyPointerMode],
  );

  const applyTool = useCallback(async (tool: Tool) => {
    setCurrentTool(tool);
    await invoke("emit_to_overlay", { event: "tool-changed", payload: { tool } });
    const { penColor: pen, highlighterColor: hl } = colorsRef.current;
    await invoke("emit_to_overlay", {
      event: "color-changed",
      payload: { color: tool === "highlighter" ? hl : pen },
    });
  }, []);

  const enableAndSelect = useCallback(
    async (tool: Tool) => {
      if (pointerModeRef.current === "laser") await applyPointerMode("off");
      if (!drawingEnabled) await applyDrawingEnabled(true);
      if (tool !== "pen" && tool !== "highlighter" && tool !== "eraser") {
        setCurrentShapeTool(tool);
      }
      setToolsExpanded(false);
      await applyTool(tool);
    },
    [applyDrawingEnabled, applyPointerMode, applyTool, drawingEnabled],
  );

  /** Toggle a primary tool off (back to click-through) if already selected. */
  const togglePrimaryTool = useCallback(
    async (tool: Tool) => {
      if (drawingEnabled && currentTool === tool) {
        await applyDrawingEnabled(false);
        return;
      }
      await enableAndSelect(tool);
    },
    [applyDrawingEnabled, currentTool, drawingEnabled, enableAndSelect],
  );

  const handleClear = useCallback(async () => {
    await invoke("emit_to_overlay", { event: "shortcut-clear", payload: null });
  }, []);

  const handleUndo = useCallback(async () => {
    await invoke("emit_to_overlay", { event: "shortcut-undo", payload: null });
  }, []);

  const handleRedo = useCallback(async () => {
    await invoke("emit_to_overlay", { event: "shortcut-redo", payload: null });
  }, []);

  const handleZoom = useCallback(async () => {
    await invoke("emit_to_overlay", { event: "zoom-toggle", payload: null });
  }, []);

  const handleResetPosition = useCallback(async () => {
    await invoke("reset_toolbar_position");
  }, []);

  const handleQuit = useCallback(async () => {
    await invoke("quit_app");
  }, []);

  const visibleColors = colorsExpanded ? PRESET_COLORS : [currentColor];
  const toolbarWidth =
    TOOLBAR_WIDTH_BASE +
    (toolsExpanded ? TOOLBAR_WIDTH_TOOLS_DELTA : 0) +
    (colorsExpanded ? TOOLBAR_WIDTH_COLORS_DELTA : 0);

  // Sync state to newly spawned overlays
  useEffect(() => {
    const unlisten = listen("request-state", () => {
      void invoke("emit_to_overlay", {
        event: "drawing-toggled",
        payload: { enabled: drawingEnabledRef.current },
      });
      void invoke("emit_to_overlay", { event: "tool-changed", payload: { tool: currentTool } });
      void invoke("emit_to_overlay", { event: "color-changed", payload: { color: currentColor } });
      void invoke("emit_to_overlay", { event: "size-changed", payload: { size: currentSize } });
      void invoke("emit_to_overlay", {
        event: "pointer-mode-changed",
        payload: { mode: pointerModeRef.current },
      });
    });
    return () => {
      unlisten.then((fn) => fn()).catch(console.error);
    };
  }, [currentTool, currentColor, currentSize]);

  // Global shortcuts from Rust (reliable path — not the fake modal)
  useEffect(() => {
    const subs: Array<() => void> = [];
    (async () => {
      subs.push(
        await listen("shortcut-toggle", () =>
          applyOverlayVisible(!overlayVisibleRef.current),
        ),
      );
      subs.push(await listen("shortcut-spotlight", () => togglePointerMode("spotlight")));
      subs.push(await listen("shortcut-laser", () => togglePointerMode("laser")));
      subs.push(
        await listen("shortcut-draw-toggle", () => {
          if (!drawingEnabledRef.current && pointerModeRef.current === "laser") {
            void applyPointerMode("off");
          }
          void applyDrawingEnabled(!drawingEnabledRef.current);
        }),
      );
      subs.push(
        await listen("overlay-escape", () => {
          if (drawingEnabledRef.current) void applyDrawingEnabled(false);
        }),
      );
    })();
    return () => subs.forEach((fn) => fn());
  }, [applyOverlayVisible, applyDrawingEnabled, applyPointerMode, togglePointerMode]);

  // Persist toolbar drag position
  useEffect(() => {
    const win = getCurrentWindow();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | undefined;

    void win.onMoved(({ payload }) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        void invoke("save_toolbar_position", { x: payload.x, y: payload.y });
      }, 120);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    void invoke("set_toolbar_width", { width: toolbarWidth });
  }, [toolbarWidth]);

  return (
    <div
      className="flex items-center px-2.5 h-[60px] bg-neutral-900/95 rounded-xl shadow-xl select-none border border-neutral-800/80"
      style={{ width: toolbarWidth }}
    >
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          void getCurrentWindow().startDragging();
        }}
        title="Drag"
        className="flex-shrink-0 mr-1 flex items-center justify-center w-5 h-7 rounded-md text-neutral-400 hover:bg-neutral-700/80 cursor-grab active:cursor-grabbing"
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
          <circle cx="2" cy="2" r="1" fill="currentColor" />
          <circle cx="8" cy="2" r="1" fill="currentColor" />
          <circle cx="2" cy="7" r="1" fill="currentColor" />
          <circle cx="8" cy="7" r="1" fill="currentColor" />
          <circle cx="2" cy="12" r="1" fill="currentColor" />
          <circle cx="8" cy="12" r="1" fill="currentColor" />
        </svg>
      </button>

      <Btn
        active={overlayVisible}
        onClick={() => applyOverlayVisible(!overlayVisible)}
        title="Overlay (⌃⇧X)"
      >
        <EyeIcon on={overlayVisible} />
      </Btn>

      <Sep />

      <Btn
        active={drawingEnabled && currentTool === "pen"}
        disabled={!overlayVisible}
        onClick={() => void togglePrimaryTool("pen")}
        title="Pen (⌃⇧D)"
      >
        <PenIcon />
      </Btn>

      <Btn
        active={drawingEnabled && currentTool === "highlighter"}
        disabled={!overlayVisible}
        onClick={() => void togglePrimaryTool("highlighter")}
        title="Highlighter"
      >
        <HighlighterIcon />
      </Btn>

      <Btn
        active={drawingEnabled && currentTool === "eraser"}
        disabled={!overlayVisible}
        onClick={() => void togglePrimaryTool("eraser")}
        title="Eraser"
      >
        <EraserIcon />
      </Btn>

      <Btn
        active={pointerMode === "laser"}
        disabled={!overlayVisible}
        onClick={() => void togglePointerMode("laser")}
        title="Laser pointer (⌃⇧L)"
      >
        <LaserIcon />
      </Btn>

      <Btn
        active={pointerMode === "spotlight"}
        disabled={!overlayVisible}
        onClick={() => void togglePointerMode("spotlight")}
        title="Spotlight (⌃⇧S)"
      >
        <SpotIcon />
      </Btn>

      <Btn onClick={() => void handleZoom()} title="Zoom (⌃⇧M) — scroll to change level, Esc to exit">
        <ZoomIcon />
      </Btn>

      <div className="flex items-center gap-0.5 ml-0.5">
        {(toolsExpanded ? SHAPE_TOOLS : [currentShapeTool]).map((t) => (
          <Btn
            key={t}
            active={drawingEnabled && currentTool === t}
            disabled={!overlayVisible}
            onClick={() => void enableAndSelect(t)}
            title={toolTitle(t)}
          >
            <ToolIcon tool={t} />
          </Btn>
        ))}
        <button
          onClick={() => setToolsExpanded((v) => !v)}
          title={toolsExpanded ? "Collapse shapes" : "More shapes"}
          className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded text-neutral-400 hover:bg-neutral-700/80"
        >
          <ChevronIcon expanded={toolsExpanded} />
        </button>
      </div>

      <Sep />

      <div className="flex flex-shrink-0 gap-1 items-center">
        {visibleColors.map((c) => (
          <button
            key={c}
            onClick={() => applyColor(c)}
            title={c}
            className="flex-shrink-0 w-[16px] h-[16px] rounded-full border-2 transition-transform"
            style={{
              backgroundColor: c,
              borderColor: currentColor === c ? "#fff" : "transparent",
              transform: currentColor === c ? "scale(1.2)" : "scale(1)",
            }}
          />
        ))}
      </div>
      <button
        onClick={() => setColorsExpanded((v) => !v)}
        title={colorsExpanded ? "Fewer colors" : "More colors"}
        className="flex-shrink-0 ml-0.5 flex items-center justify-center w-5 h-5 rounded text-neutral-400 hover:bg-neutral-700/80"
      >
        <ChevronIcon expanded={colorsExpanded} />
      </button>

      <Sep />

      <div className="flex flex-shrink-0 gap-0.5 items-center">
        {PEN_SIZES.map((s) => (
          <button
            key={s}
            onClick={() => applySize(s)}
            title={`Size ${s}`}
            className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-neutral-700/80"
            style={{ backgroundColor: currentSize === s ? "#404040" : "transparent" }}
          >
            <div className="rounded-full bg-white" style={{ width: s, height: s }} />
          </button>
        ))}
      </div>

      <Sep />

      <Btn onClick={handleUndo} title="Undo (⌃⇧Z)">
        <UndoIcon />
      </Btn>
      <Btn onClick={handleRedo} title="Redo (⌃⇧Y)">
        <RedoIcon />
      </Btn>
      <Btn onClick={handleClear} title="Clear (⌃⇧C)">
        <TrashIcon />
      </Btn>

      <Sep />

      <Btn onClick={handleResetPosition} title="Reset position">
        <ResetIcon />
      </Btn>
      <Btn onClick={handleQuit} title="Quit">
        <QuitIcon />
      </Btn>
    </div>
  );
}

function toolTitle(tool: Tool): string {
  switch (tool) {
    case "line":
      return "Line";
    case "rectangle":
      return "Rectangle";
    case "ellipse":
      return "Ellipse";
    case "arrow":
      return "Arrow";
    case "text":
      return "Text";
    default:
      return tool;
  }
}

function Btn({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md transition-colors text-white mx-px",
        active ? "bg-blue-600/90 hover:bg-blue-500" : "hover:bg-neutral-700/80",
        disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-6 bg-neutral-700/80 mx-1 flex-shrink-0" />;
}

function EyeIcon({ on }: { on: boolean }) {
  return on ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

function HighlighterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m9 11-6 6v3h3l6-6" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l12-12a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L10 21" />
      <path d="M22 21H7" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="4" y1="20" x2="20" y2="4" />
    </svg>
  );
}

function RectIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="6" width="14" height="12" />
    </svg>
  );
}

function EllipseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="12" rx="7" ry="5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="4" y1="20" x2="20" y2="4" />
      <polyline points="11 4 20 4 20 13" />
    </svg>
  );
}

function SpotIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
    </svg>
  );
}

function LaserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="17" cy="7" r="3" fill="currentColor" />
      <path d="M3 21l8-8" opacity="0.5" />
      <path d="M8 18l4-4" opacity="0.8" />
    </svg>
  );
}

function ZoomIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16" y2="16" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15 14 20 9 15 4" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-9.36L1 10" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7V5h16v2" />
      <path d="M9 21h6" />
      <path d="M12 5v14" />
    </svg>
  );
}

function QuitIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function ToolIcon({ tool }: { tool: Tool }) {
  switch (tool) {
    case "line":
      return <LineIcon />;
    case "rectangle":
      return <RectIcon />;
    case "ellipse":
      return <EllipseIcon />;
    case "arrow":
      return <ArrowIcon />;
    case "text":
      return <TextIcon />;
    default:
      return null;
  }
}
