import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Tool, PointerMode } from "../types";
import { PRESET_COLORS, PEN_SIZES, DEFAULT_HIGHLIGHTER_COLOR } from "../types";

const SHAPE_TOOLS: Tool[] = ["line", "rectangle", "ellipse", "arrow", "text"];

export function Toolbar() {
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [currentTool, setCurrentTool] = useState<Tool>("pen");
  const [currentShapeTool, setCurrentShapeTool] = useState<Tool>("line");
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [pointerMode, setPointerMode] = useState<PointerMode>("off");
  const [fadeEnabled, setFadeEnabled] = useState(false);
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
  const fadeEnabledRef = useRef(fadeEnabled);
  fadeEnabledRef.current = fadeEnabled;
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

  const applyFade = useCallback(async (enabled: boolean) => {
    setFadeEnabled(enabled);
    fadeEnabledRef.current = enabled;
    await invoke("emit_to_overlay", { event: "fade-mode-changed", payload: { enabled } });
  }, []);

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
  const barRef = useRef<HTMLDivElement>(null);

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
      void invoke("emit_to_overlay", {
        event: "fade-mode-changed",
        payload: { enabled: fadeEnabledRef.current },
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
      subs.push(await listen("shortcut-fade", () => applyFade(!fadeEnabledRef.current)));
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
  }, [applyOverlayVisible, applyDrawingEnabled, applyPointerMode, togglePointerMode, applyFade]);

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

  // Size the native window to the rendered bar (expanding shapes/colors changes it)
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    let last = 0;
    const sync = () => {
      const width = Math.ceil(el.getBoundingClientRect().width);
      if (width && width !== last) {
        last = width;
        void invoke("set_toolbar_width", { width });
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const off = !overlayVisible;

  return (
    <div
      ref={barRef}
      data-tauri-drag-region
      className="inline-flex items-center gap-1.5 h-[60px] pl-1.5 pr-2 rounded-2xl text-zinc-100 select-none whitespace-nowrap"
      style={{
        background: "linear-gradient(180deg, rgba(44,44,48,0.80) 0%, rgba(26,26,29,0.88) 100%)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.07)",
      }}
    >
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          void getCurrentWindow().startDragging();
        }}
        title="Drag"
        className="flex-shrink-0 flex items-center justify-center w-4 h-9 rounded-md text-zinc-500 hover:text-zinc-300 cursor-grab active:cursor-grabbing transition-colors"
      >
        <GripIcon />
      </button>

      <Group>
        <Btn active={overlayVisible} tone="neutral" onClick={() => applyOverlayVisible(!overlayVisible)} title="Show overlay (⌃⇧X)">
          <EyeIcon on={overlayVisible} />
        </Btn>
      </Group>

      <Group>
        <Btn
          active={drawingEnabled && currentTool === "pen"}
          disabled={off}
          onClick={() => void togglePrimaryTool("pen")}
          title="Pen (⌃⇧D)"
          indicator={penColor}
        >
          <PenIcon />
        </Btn>
        <Btn
          active={drawingEnabled && currentTool === "highlighter"}
          disabled={off}
          onClick={() => void togglePrimaryTool("highlighter")}
          title="Highlighter — hold ⇧ for a straight line"
          indicator={highlighterColor}
        >
          <HighlighterIcon />
        </Btn>
        <Btn
          active={drawingEnabled && currentTool === "eraser"}
          disabled={off}
          onClick={() => void togglePrimaryTool("eraser")}
          title="Eraser"
        >
          <EraserIcon />
        </Btn>
        {(toolsExpanded ? SHAPE_TOOLS : [currentShapeTool]).map((t) => (
          <Btn
            key={t}
            active={drawingEnabled && currentTool === t}
            disabled={off}
            onClick={() => void enableAndSelect(t)}
            title={toolTitle(t)}
          >
            <ToolIcon tool={t} />
          </Btn>
        ))}
        <Expander
          expanded={toolsExpanded}
          onClick={() => setToolsExpanded((v) => !v)}
          title={toolsExpanded ? "Fewer shapes" : "More shapes"}
        />
      </Group>

      <Group>
        <Btn
          active={pointerMode === "laser"}
          tone="red"
          disabled={off}
          onClick={() => void togglePointerMode("laser")}
          title="Laser pointer (⌃⇧L)"
        >
          <LaserIcon />
        </Btn>
        <Btn
          active={pointerMode === "spotlight"}
          disabled={off}
          onClick={() => void togglePointerMode("spotlight")}
          title="Spotlight (⌃⇧S)"
        >
          <SpotIcon />
        </Btn>
        <Btn
          active={fadeEnabled}
          tone="violet"
          disabled={off}
          onClick={() => void applyFade(!fadeEnabled)}
          title="Fading ink (⌃⇧F) — new strokes disappear after a few seconds"
        >
          <FadeIcon />
        </Btn>
        <Btn onClick={() => void handleZoom()} title="Zoom (⌃⇧M) — scroll to change level, Esc to exit">
          <ZoomIcon />
        </Btn>
      </Group>

      <Group>
        <div className="flex items-center gap-1.5 px-1.5">
          {visibleColors.map((c) => {
            const selected = currentColor === c;
            return (
              <button
                key={c}
                onClick={() => applyColor(c)}
                title={c}
                className="flex-shrink-0 w-[18px] h-[18px] rounded-full transition-transform duration-150 hover:scale-110"
                style={{
                  backgroundColor: c,
                  boxShadow: selected
                    ? "0 0 0 2px #1d1d20, 0 0 0 3.5px rgba(255,255,255,0.95)"
                    : "inset 0 0 0 1px rgba(255,255,255,0.18)",
                }}
              />
            );
          })}
        </div>
        <Expander
          expanded={colorsExpanded}
          onClick={() => setColorsExpanded((v) => !v)}
          title={colorsExpanded ? "Fewer colors" : "More colors"}
        />
        <div className="w-px h-4 bg-white/10 mx-0.5" />
        {PEN_SIZES.map((s) => (
          <button
            key={s}
            onClick={() => applySize(s)}
            title={`Stroke size ${s}`}
            className={[
              "flex-shrink-0 flex items-center justify-center w-[26px] h-[30px] rounded-[9px] transition-colors duration-150",
              currentSize === s ? "bg-white/15" : "hover:bg-white/10",
            ].join(" ")}
          >
            <div
              className="rounded-full"
              style={{
                width: SIZE_DOTS[s] ?? s,
                height: SIZE_DOTS[s] ?? s,
                backgroundColor: currentSize === s ? "#fff" : "rgba(255,255,255,0.6)",
              }}
            />
          </button>
        ))}
      </Group>

      <Group>
        <Btn onClick={handleUndo} title="Undo (⌃⇧Z)">
          <UndoIcon />
        </Btn>
        <Btn onClick={handleRedo} title="Redo (⌃⇧Y)">
          <RedoIcon />
        </Btn>
        <Btn onClick={handleClear} title="Clear all (⌃⇧C)" tone="danger-hover">
          <TrashIcon />
        </Btn>
      </Group>

      <div className="flex items-center gap-0.5">
        <Btn onClick={handleResetPosition} title="Reset toolbar position" subtle>
          <ResetIcon />
        </Btn>
        <Btn onClick={handleQuit} title="Quit Mira" subtle tone="danger-hover">
          <QuitIcon />
        </Btn>
      </div>
    </div>
  );
}

// Visual dot diameter per stroke size (keeps the largest inside the button)
const SIZE_DOTS: Record<number, number> = { 3: 4, 6: 7, 12: 11 };

function toolTitle(tool: Tool): string {
  switch (tool) {
    case "line":
      return "Line — hold ⇧ to snap 45°";
    case "rectangle":
      return "Rectangle — hold ⇧ for a square";
    case "ellipse":
      return "Ellipse — hold ⇧ for a circle";
    case "arrow":
      return "Arrow — hold ⇧ to snap 45°";
    case "text":
      return "Text — click to type, drag to move";
    default:
      return tool;
  }
}

function Group({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-shrink-0 items-center gap-0.5 p-[3px] rounded-[12px]"
      style={{
        background: "rgba(255,255,255,0.045)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
      }}
    >
      {children}
    </div>
  );
}

type Tone = "blue" | "red" | "violet" | "neutral" | "danger-hover";

const ACTIVE_TONES: Record<Exclude<Tone, "danger-hover">, { bg: string; glow: string }> = {
  blue: { bg: "#0a84ff", glow: "rgba(10,132,255,0.45)" },
  red: { bg: "#ff453a", glow: "rgba(255,69,58,0.45)" },
  violet: { bg: "#8e5cf7", glow: "rgba(142,92,247,0.45)" },
  // For on-by-default toggles (overlay visible): present but quiet
  neutral: { bg: "rgba(255,255,255,0.16)", glow: "rgba(0,0,0,0)" },
};

function Btn({
  onClick,
  active,
  disabled,
  title,
  tone = "blue",
  indicator,
  subtle,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  tone?: Tone;
  /** Small color bar under the icon (current pen / highlighter color). */
  indicator?: string;
  subtle?: boolean;
  children: React.ReactNode;
}) {
  const palette = ACTIVE_TONES[tone === "danger-hover" ? "blue" : tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "relative flex-shrink-0 flex items-center justify-center w-[30px] h-[30px] rounded-[9px] transition-all duration-150",
        active
          ? "text-white"
          : [
              subtle ? "text-zinc-400" : "text-zinc-200",
              tone === "danger-hover" ? "hover:bg-red-500/20 hover:text-red-300" : "hover:bg-white/10 hover:text-white",
            ].join(" "),
        disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer active:scale-[0.92]",
      ].join(" ")}
      style={
        active
          ? {
              background: palette.bg,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 12px -3px ${palette.glow}`,
            }
          : undefined
      }
    >
      {children}
      {indicator && (
        <span
          className="absolute bottom-[3px] left-1/2 -translate-x-1/2 w-3 h-[3px] rounded-full"
          style={{ backgroundColor: indicator, boxShadow: "0 0 0 0.5px rgba(0,0,0,0.4)" }}
        />
      )}
    </button>
  );
}

function Expander({ expanded, onClick, title }: { expanded: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex-shrink-0 flex items-center justify-center w-[18px] h-[30px] rounded-[7px] text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors"
    >
      <ChevronIcon expanded={expanded} />
    </button>
  );
}

// ── Icons (16px, 1.75 stroke, round joins — Lucide-style) ─────────────────────

function Icon({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function GripIcon() {
  return (
    <svg width="8" height="16" viewBox="0 0 8 16" fill="currentColor">
      {[2, 8, 14].map((y) => (
        <g key={y}>
          <circle cx="2" cy={y} r="1.2" />
          <circle cx="6" cy={y} r="1.2" />
        </g>
      ))}
    </svg>
  );
}

function EyeIcon({ on }: { on: boolean }) {
  return on ? (
    <Icon>
      <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  ) : (
    <Icon>
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c4.7 0 8.7 2.94 9.94 7a10.8 10.8 0 0 1-1.44 2.49" />
      <path d="M14.08 14.16a3 3 0 0 1-4.24-4.24" />
      <path d="M17.48 17.5A10.75 10.75 0 0 1 2.06 12a10.8 10.8 0 0 1 4.45-5.5" />
      <path d="m2 2 20 20" />
    </Icon>
  );
}

function PenIcon() {
  return (
    <Icon>
      <path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" />
      <path d="m15 5 4 4" />
    </Icon>
  );
}

function HighlighterIcon() {
  return (
    <Icon>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </Icon>
  );
}

function EraserIcon() {
  return (
    <Icon>
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </Icon>
  );
}

function LineIcon() {
  return (
    <Icon>
      <path d="M5 19 19 5" />
    </Icon>
  );
}

function RectIcon() {
  return (
    <Icon>
      <rect x="4" y="6" width="16" height="12" rx="2" />
    </Icon>
  );
}

function EllipseIcon() {
  return (
    <Icon>
      <ellipse cx="12" cy="12" rx="8.5" ry="6" />
    </Icon>
  );
}

function ArrowIcon() {
  return (
    <Icon>
      <path d="M6 18 18 6" />
      <path d="M9 6h9v9" />
    </Icon>
  );
}

function TextIcon() {
  return (
    <Icon>
      <path d="M4 7V5h16v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </Icon>
  );
}

function LaserIcon() {
  return (
    <Icon>
      <path d="M4 20 13 11" opacity="0.55" />
      <circle cx="16.5" cy="7.5" r="2.5" fill="currentColor" />
      <path d="M16.5 2v1.5M22 7.5h-1.5M20.4 3.6l-1 1M20.4 11.4l-1-1" />
    </Icon>
  );
}

function SpotIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="12" cy="12" r="8.5" strokeDasharray="2.2 3" />
    </Icon>
  );
}

function FadeIcon() {
  return (
    <Icon>
      <path d="M3 16c2-4 4.5-5 6.5-2.5" />
      <path d="M12 14.5c1.5 1.5 3 1 4.2-.8" opacity="0.6" />
      <path d="M18.6 11.2 19 10.5M21 8.5l.1-.2" opacity="0.35" />
    </Icon>
  );
}

function ZoomIcon() {
  return (
    <Icon>
      <circle cx="11" cy="11" r="7.5" />
      <path d="m21 21-4.3-4.3" />
      <path d="M11 8v6M8 11h6" />
    </Icon>
  );
}

function UndoIcon() {
  return (
    <Icon>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
  );
}

function RedoIcon() {
  return (
    <Icon>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Icon>
  );
}

function TrashIcon() {
  return (
    <Icon>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Icon>
  );
}

function ResetIcon() {
  return (
    <Icon size={15}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </Icon>
  );
}

function QuitIcon() {
  return (
    <Icon size={15}>
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
    </Icon>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <Icon size={12}>
      <path d={expanded ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </Icon>
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
