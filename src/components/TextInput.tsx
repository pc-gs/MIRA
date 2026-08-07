import { useState, useRef, useEffect } from "react";

interface TextInputProps {
  x: number;
  y: number;
  color: string;
  fontSize: number;
  initialText?: string;
  onSubmit: (text: string, position: { x: number; y: number }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

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
  const submittedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    if (initialText) {
      inputRef.current?.select();
    }
  }, [initialText]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      submittedRef.current = true;
      if (text.trim()) {
        onSubmit(text.trim(), { x, y });
      } else if (onDelete) {
        onDelete();
      } else {
        onCancel();
      }
    } else if (e.key === "Escape") {
      submittedRef.current = true;
      onCancel();
    }
  };

  const handleBlur = () => {
    if (submittedRef.current) return;
    if (text.trim()) {
      onSubmit(text.trim(), { x, y });
    } else if (onDelete) {
      onDelete();
    } else {
      onCancel();
    }
  };

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
      className="absolute bg-transparent border-none outline-none focus:outline-none focus:ring-0 p-0 select-text z-50 caret-current"
      style={{
        left: x,
        top: y,
        transform: "translateY(-50%)",
        color,
        fontSize: `${fontSize * 3}px`,
        fontFamily: "system-ui, -apple-system, sans-serif",
        lineHeight: 1.2,
        minWidth: "40px",
        width: `${Math.max(60, (text.length || 6) * (fontSize * 1.8))}px`,
      }}
      placeholder="Digite..."
    />
  );
}
