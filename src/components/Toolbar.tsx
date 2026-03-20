import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Tool } from "../types";
import { PRESET_COLORS, PEN_SIZES } from "../types";

const TOOLBAR_WIDTH_BASE = 540;
const TOOLBAR_WIDTH_TOOLS_DELTA = 96;
const TOOLBAR_WIDTH_COLORS_DELTA = 104;
const SHAPE_TOOLS: Tool[] = ["line", "rectangle", "ellipse", "arrow", "text"];

export function Toolbar() {
  const [overlayVisible, setOverlayVisible]     = useState(true);
  const [drawingEnabled, setDrawingEnabled]     = useState(false);
  const [currentTool, setCurrentTool]           = useState<Tool>("pen");
  const [currentShapeTool, setCurrentShapeTool] = useState<Tool>("line");
  const [toolsExpanded, setToolsExpanded]       = useState(false);
  const [spotlightEnabled, setSpotlightEnabled] = useState(false);
  const [currentColor, setCurrentColor]         = useState<string>(PRESET_COLORS[0]);
  const [currentSize, setCurrentSize]           = useState<number>(6);
  const [colorsExpanded, setColorsExpanded]     = useState(false);

  // Refs so shortcut listeners (registered once) always read current state
  // without needing to re-subscribe on every state change.
  const overlayVisibleRef   = useRef(overlayVisible);
  const drawingEnabledRef   = useRef(drawingEnabled);
  const spotlightEnabledRef = useRef(spotlightEnabled);
  useEffect(() => { overlayVisibleRef.current   = overlayVisible;   }, [overlayVisible]);
  useEffect(() => { drawingEnabledRef.current   = drawingEnabled;   }, [drawingEnabled]);
  useEffect(() => { spotlightEnabledRef.current = spotlightEnabled; }, [spotlightEnabled]);

  // ── Overlay state changes ────────────────────────────────────────────────

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
    // Update canvas cursor style before changing passthrough, so the overlay
    // never briefly captures events while still showing cursor: none.
    await invoke("emit_to_overlay", { event: "drawing-toggled", payload: { enabled } });
    await invoke("set_overlay_passthrough", { passThrough: !enabled });
  }, []);

  const applyColor = useCallback(async (color: string) => {
    setCurrentColor(color);
    setColorsExpanded(false);
    await invoke("emit_to_overlay", { event: "color-changed", payload: { color } });
  }, []);

  const applySize = useCallback(async (size: number) => {
    setCurrentSize(size);
    await invoke("emit_to_overlay", { event: "size-changed", payload: { size } });
  }, []);

  const applySpotlight = useCallback(async (enabled: boolean) => {
    setSpotlightEnabled(enabled);
    await invoke("emit_to_overlay", { event: "spotlight-toggled", payload: { enabled } });
  }, []);

  const applyTool = useCallback(async (tool: Tool) => {
    setCurrentTool(tool);
    await invoke("emit_to_overlay", { event: "tool-changed", payload: { tool } });
  }, []);

  const handleSelectTool = useCallback(async (tool: Tool) => {
    if (!drawingEnabled) await applyDrawingEnabled(true);
    setToolsExpanded(false);
    if (tool !== "pen") setCurrentShapeTool(tool);
    await applyTool(tool);
  }, [applyDrawingEnabled, applyTool, drawingEnabled]);

  const handlePen = useCallback(async () => {
    if (drawingEnabled && currentTool === "pen") {
      await applyDrawingEnabled(false);
      return;
    }
    if (!drawingEnabled) await applyDrawingEnabled(true);
    await applyTool("pen");
  }, [applyDrawingEnabled, applyTool, currentTool, drawingEnabled]);

  const handleClear = useCallback(async () => {
    await invoke("emit_to_overlay", { event: "shortcut-clear", payload: null });
  }, []);

  const handleUndo = useCallback(async () => {
    await invoke("emit_to_overlay", { event: "shortcut-undo", payload: null });
  }, []);

  const handleRedo = useCallback(async () => {
    await invoke("emit_to_overlay", { event: "shortcut-redo", payload: null });
  }, []);

  const handleResetPosition = useCallback(async () => {
    await invoke("reset_toolbar_position");
  }, []);

  const handleQuit = useCallback(async () => {
    await invoke("quit_app");
  }, []);
  const toggleColorsExpanded = useCallback(() => {
    setColorsExpanded((v) => !v);
  }, []);
  const toggleToolsExpanded = useCallback(() => {
    setToolsExpanded((v) => !v);
  }, []);

  const visibleColors = (() => {
    if (colorsExpanded) return PRESET_COLORS;
    return [currentColor];
  })();
  const toolbarWidth = TOOLBAR_WIDTH_BASE
    + (toolsExpanded ? TOOLBAR_WIDTH_TOOLS_DELTA : 0)
    + (colorsExpanded ? TOOLBAR_WIDTH_COLORS_DELTA : 0);

  useEffect(() => {
    const unlisten = listen("request-state", () => {
      // Use refs to broadcast the latest state whenever an overlay requests it
      void invoke("emit_to_overlay", { event: "drawing-toggled", payload: { enabled: drawingEnabledRef.current } });
      void invoke("emit_to_overlay", { event: "tool-changed", payload: { tool: currentTool } });
      void invoke("emit_to_overlay", { event: "color-changed", payload: { color: currentColor } });
      void invoke("emit_to_overlay", { event: "size-changed", payload: { size: currentSize } });
      void invoke("emit_to_overlay", { event: "spotlight-toggled", payload: { enabled: spotlightEnabledRef.current } });
    });
    return () => {
      unlisten.then((fn) => fn()).catch(console.error);
    };
  }, [currentTool, currentColor, currentSize]);

  // ── Global shortcut listeners (registered once — state read via refs) ────

  useEffect(() => {
    const subs: Array<() => void> = [];
    (async () => {
      subs.push(await listen("shortcut-toggle",      () => applyOverlayVisible(!overlayVisibleRef.current)));
      subs.push(await listen("shortcut-spotlight",   () => applySpotlight(!spotlightEnabledRef.current)));
      subs.push(await listen("shortcut-draw-toggle", () => applyDrawingEnabled(!drawingEnabledRef.current)));
    })();
    return () => subs.forEach((fn) => fn());
  }, [applyOverlayVisible, applyDrawingEnabled, applySpotlight]); // stable callbacks, register once

  // Persist toolbar position whenever it is dragged.
  useEffect(() => {
    const win = getCurrentWindow();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await win.onMoved(({ payload }) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          void invoke("save_toolbar_position", { x: payload.x, y: payload.y });
        }, 120);
      });
    };

    void setup();
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    void invoke("set_toolbar_width", { width: toolbarWidth });
  }, [toolbarWidth]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="flex items-center px-2.5 h-[60px] bg-neutral-900 rounded-xl shadow-2xl select-none"
      style={{ width: toolbarWidth }}
    >
      {/* Explicit drag handle for reliable toolbar movement on all clickable layouts */}
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          void getCurrentWindow().startDragging();
        }}
        title="Drag toolbar"
        className="flex-shrink-0 mr-1 flex items-center justify-center w-5 h-7 rounded-md text-neutral-300 hover:bg-neutral-700 cursor-grab active:cursor-grabbing"
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

      {/* Toggle visibility */}
      <Btn active={overlayVisible} onClick={() => applyOverlayVisible(!overlayVisible)} title="Toggle (⌃⇧X)">
        <EyeIcon on={overlayVisible} />
      </Btn>

      <Sep />

      {/* Pencil */}
      <Btn active={drawingEnabled && currentTool === "pen"} disabled={!overlayVisible} onClick={() => void handlePen()} title="Pencil (⌃⇧D)">
        <PenIcon />
      </Btn>

      {/* Mouse tracker */}
      <Btn active={spotlightEnabled} disabled={!overlayVisible} onClick={() => applySpotlight(!spotlightEnabled)} title="Mouse tracker (⌃⇧S)">
        <SpotIcon />
      </Btn>

      {/* Shape tools (collapsible) */}
      <div className="flex items-center gap-1 ml-1">
        {(toolsExpanded ? SHAPE_TOOLS : [currentShapeTool]).map((tool) => (
          <Btn
            key={tool}
            active={drawingEnabled && currentTool === tool}
            disabled={!overlayVisible}
            onClick={() => void handleSelectTool(tool)}
            title={`${tool[0].toUpperCase()}${tool.slice(1)} tool`}
          >
            <ToolIcon tool={tool} />
          </Btn>
        ))}
        <button
          onClick={toggleToolsExpanded}
          title={toolsExpanded ? "Show selected tool only" : "Show all tools"}
          className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded text-neutral-300 hover:bg-neutral-700"
        >
          <PaletteExpandIcon expanded={toolsExpanded} />
        </button>
      </div>

      <Sep />

      {/* Colors */}
      <div className="flex flex-shrink-0 gap-1">
        {visibleColors.map((c) => (
          <button
            key={c}
            onClick={() => applyColor(c)}
            className="flex-shrink-0 w-[18px] h-[18px] rounded-full border-2 transition-transform"
            style={{
              backgroundColor: c,
              borderColor: currentColor === c ? "#fff" : "transparent",
              transform: currentColor === c ? "scale(1.25)" : "scale(1)",
            }}
          />
        ))}
      </div>
      <button
        onClick={toggleColorsExpanded}
        title={colorsExpanded ? "Show fewer colors" : "Show more colors"}
        className="flex-shrink-0 ml-1 flex items-center justify-center w-5 h-5 rounded text-neutral-300 hover:bg-neutral-700"
      >
        <PaletteExpandIcon expanded={colorsExpanded} />
      </button>

      <Sep />

      {/* Pen sizes */}
      <div className="flex flex-shrink-0 gap-0.5 items-center">
        {PEN_SIZES.map((s) => (
          <button
            key={s}
            onClick={() => applySize(s)}
            className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-neutral-700"
            style={{ backgroundColor: currentSize === s ? "#404040" : "transparent" }}
          >
            <div className="rounded-full bg-white" style={{ width: s, height: s }} />
          </button>
        ))}
      </div>

      <Sep />

      {/* Undo / Redo / Clear */}
      <Btn onClick={handleUndo} title="Undo (⌃⇧Z)"><UndoIcon /></Btn>
      <Btn onClick={handleRedo} title="Redo (⌃⇧Y)"><RedoIcon /></Btn>
      <Btn onClick={handleClear} title="Clear (⌃⇧C)"><TrashIcon /></Btn>

      <Sep />

      {/* Reset toolbar position */}
      <Btn onClick={handleResetPosition} title="Reset toolbar position"><ResetIcon /></Btn>

      <Sep />

      {/* Quit */}
      <Btn onClick={handleQuit} title="Quit"><QuitIcon /></Btn>
    </div>
  );
}

// ── Small reusables ───────────────────────────────────────────────────────────

function Btn({ onClick, active, disabled, title, children }: {
  onClick: () => void; active?: boolean; disabled?: boolean;
  title?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      className={[
        "flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md transition-colors text-white mx-[1px]",
        active ? "bg-blue-600 hover:bg-blue-500" : "hover:bg-neutral-700",
        disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-7 bg-neutral-700 mx-1.5 flex-shrink-0" />;
}

// Inline SVG icons (stroke="currentColor", no icon lib needed)
function EyeIcon({ on }: { on: boolean }) {
  return on
    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
}
function PenIcon()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><circle cx="11" cy="11" r="2"/></svg>; }
function LineIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="20" x2="20" y2="4"/></svg>; }
function RectIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="6" width="14" height="12"/></svg>; }
function EllipseIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="12" rx="7" ry="5"/></svg>; }
function ArrowIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="20" x2="20" y2="4"/><polyline points="11 4 20 4 20 13"/></svg>; }
function SpotIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>; }
function UndoIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>; }
function RedoIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>; }
function TrashIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>; }
function ResetIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-9.36L1 10"/></svg>; }
function PaletteExpandIcon({ expanded }: { expanded: boolean }) {
  return expanded
    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>;
}
function TextIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V5h16v2"/><path d="M9 21h6"/><path d="M12 5v14"/></svg>; }
function QuitIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>; }

function ToolIcon({ tool }: { tool: Tool }) {
  switch (tool) {
    case "pen": return <PenIcon />;
    case "line": return <LineIcon />;
    case "rectangle": return <RectIcon />;
    case "ellipse": return <EllipseIcon />;
    case "arrow": return <ArrowIcon />;
    case "text": return <TextIcon />;
    default:
      return null;
  }
}
