export interface Point { x: number; y: number; }

export type Tool = "pen" | "highlighter" | "eraser" | "line" | "rectangle" | "ellipse" | "arrow" | "text";

export interface Stroke {
  id?: string;
  tool: Tool;
  color: string;   // raw CSS color e.g. "#ef4444"
  width: number;
  points?: Point[]; // freehand only
  start?: Point;    // shapes only
  end?: Point;      // shapes only
  text?: string;    // text only
  position?: Point; // text only
}

export const PRESET_COLORS = [
  "#ffffff", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#3b82f6",
] as const;
export type PresetColor = typeof PRESET_COLORS[number];

export const PEN_SIZES = [3, 6, 12] as const;
export type PenSize = typeof PEN_SIZES[number];
