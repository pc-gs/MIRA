import type { Tool } from "../types";
import { PRESET_COLORS } from "../types";

/** Action for a single-key shortcut in draw mode. The toolbar owns the state it changes. */
export type DrawCommand =
  | { kind: "tool"; tool: Tool }
  | { kind: "color"; index: number; highlighter: boolean }
  | { kind: "size"; delta: 1 | -1 }
  | { kind: "clear" }
  | { kind: "help" };

/** Tools that can be held ("spring-loaded"): hold the key while dragging, release to go back. */
export const SPRING_TOOLS: Partial<Record<string, Tool>> = {
  l: "line",
  a: "arrow",
  r: "rectangle",
  o: "ellipse",
  e: "eraser",
};

/** Tools that switch on key press only. */
const TAP_TOOLS: Partial<Record<string, Tool>> = {
  p: "pen",
  h: "highlighter",
  t: "text",
};

/**
 * Map a keydown in draw mode to a command, or null if the key isn't a draw shortcut.
 * ⌘/⌃/⌥ combos are left alone (undo/redo, system shortcuts, presenter quick draw).
 */
export function drawCommandForKey(e: KeyboardEvent): DrawCommand | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;

  // Physical digit keys so ⇧ (highlighter variant) works on any layout
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) {
    const index = Number(digit[1]) - 1;
    if (index >= PRESET_COLORS.length) return null;
    return { kind: "color", index, highlighter: e.shiftKey };
  }

  if (e.key === "?" || e.key === "/") return { kind: "help" };
  if (e.key === "[" || e.key === "-") return { kind: "size", delta: -1 };
  if (e.key === "]" || e.key === "=" || e.key === "+") return { kind: "size", delta: 1 };
  if (e.key === "Backspace" || e.key === "Delete") return { kind: "clear" };

  const letter = e.key.length === 1 ? e.key.toLowerCase() : "";
  const tool = TAP_TOOLS[letter] ?? SPRING_TOOLS[letter];
  if (tool) return { kind: "tool", tool };
  return null;
}

/** Rows for the in-overlay shortcut sheet ("?"). */
export const SHORTCUT_SHEET: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: "Tools",
    rows: [
      ["P", "Pen"],
      ["H", "Highlighter"],
      ["E", "Eraser"],
      ["L / A", "Line / Arrow"],
      ["R / O", "Rectangle / Ellipse"],
      ["T", "Text"],
      ["Hold L A R O E", "Use that tool while dragging, release to go back"],
    ],
  },
  {
    title: "Style",
    rows: [
      ["1 – 6", "Color"],
      ["⇧ 1 – 6", "Highlighter in that color"],
      ["[  ]   or   −  +", "Thinner / thicker"],
      ["⇧ while dragging", "Straight line, 45°, square or circle"],
    ],
  },
  {
    title: "Canvas",
    rows: [
      ["⌘Z / ⌘⇧Z", "Undo / Redo"],
      ["⌫", "Clear all"],
      ["Esc", "Leave draw mode"],
      ["?", "Show / hide this sheet"],
    ],
  },
  {
    title: "Anywhere",
    rows: [
      ["⌃⇧D", "Draw mode"],
      ["⌃⇧P", "Presenter mode (hold ⌥ to draw)"],
      ["⌃⇧L / ⌃⇧S", "Laser / Spotlight"],
      ["⌃⇧F", "Fading ink"],
      ["⌃⇧M", "Zoom"],
      ["⌃⇧H", "Show / hide toolbar"],
    ],
  },
];
