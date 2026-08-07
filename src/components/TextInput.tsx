import { useState, useRef, useEffect } from "react";

interface TextInputProps {
  x: number;
  y: number;
  color: string;
  fontSize: number;
  initialText?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

/**
 * Inline text editor for the overlay.
 * Intentionally minimal: matches final stroke style so there's no visual jump on commit.
 */
export function TextInput({
  x,
  y,
  color,
  fontSize,
  initialText = "",
  onSubmit,
  onCancel,
  onDelete,
}: TextInputProps) {
  const [text, setText] = useState(initialText);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (initialText) el.select();
  }, [initialText]);

  const finish = (value: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
    else if (onDelete) onDelete();
    else onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(text);
    } else if (e.key === "Escape") {
      e.preventDefault();
      doneRef.current = true;
      onCancel();
    }
  };

  const handleBlur = () => {
    // Defer so a click on another UI element can cancel first if needed.
    requestAnimationFrame(() => {
      if (!doneRef.current) finish(text);
    });
  };

  const px = fontSize * 3;
  const width = Math.max(80, (text.length || 4) * px * 0.58 + 12);

  return (
    <input
      ref={inputRef}
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      spellCheck={false}
      autoComplete="off"
      className="absolute z-50 bg-transparent outline-none border-none p-0 m-0"
      style={{
        left: x,
        top: y,
        transform: "translateY(-50%)",
        color,
        fontSize: `${px}px`,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontWeight: 500,
        lineHeight: 1.2,
        width: `${width}px`,
        minWidth: "80px",
        // Subtle bottom edge so the caret is findable on any slide background
        boxShadow: `inset 0 -1px 0 0 ${color}66`,
        caretColor: color,
      }}
      placeholder="…"
    />
  );
}
