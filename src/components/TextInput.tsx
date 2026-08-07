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
  const [pos, setPos] = useState({ x, y });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; posX: number; posY: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    setPos({ x, y });
  }, [x, y]);

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
        onSubmit(text.trim(), pos);
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

  const handleBlur = (e: React.FocusEvent) => {
    // Prevent blur if clicking on action buttons inside container
    if (e.relatedTarget && e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
      return;
    }
    if (submittedRef.current) return;
    if (text.trim()) {
      onSubmit(text.trim(), pos);
    } else if (onDelete) {
      onDelete();
    } else {
      onCancel();
    }
  };

  const handleDragMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: pos.x,
      posY: pos.y,
    };

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = moveEvent.clientX - dragStartRef.current.mouseX;
      const dy = moveEvent.clientY - dragStartRef.current.mouseY;
      setPos({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
    };

    const onMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      className="absolute flex items-center gap-1.5 p-1 rounded-lg border-2 border-dashed border-blue-500/80 bg-neutral-900/90 shadow-2xl backdrop-blur-md z-50 transition-shadow"
      style={{
        left: pos.x,
        top: pos.y,
        transform: "translateY(-50%)",
        cursor: isDragging ? "grabbing" : "default",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Drag handle */}
      <button
        onMouseDown={handleDragMouseDown}
        title="Arrastar texto"
        className="flex items-center justify-center p-1 text-neutral-400 hover:text-white cursor-grab active:cursor-grabbing rounded hover:bg-neutral-800"
      >
        <svg width="12" height="16" viewBox="0 0 10 14" fill="none">
          <circle cx="2" cy="2" r="1" fill="currentColor" />
          <circle cx="8" cy="2" r="1" fill="currentColor" />
          <circle cx="2" cy="7" r="1" fill="currentColor" />
          <circle cx="8" cy="7" r="1" fill="currentColor" />
          <circle cx="2" cy="12" r="1" fill="currentColor" />
          <circle cx="8" cy="12" r="1" fill="currentColor" />
        </svg>
      </button>

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="bg-transparent outline-none px-1.5 py-0.5 font-medium"
        style={{
          color,
          fontSize: `${Math.max(14, fontSize * 2.8)}px`,
          fontFamily: "system-ui, -apple-system, sans-serif",
          minWidth: "120px",
        }}
        placeholder="Digite algo..."
      />

      {/* Confirm / Delete actions */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => {
            submittedRef.current = true;
            if (text.trim()) onSubmit(text.trim(), pos);
            else if (onDelete) onDelete();
            else onCancel();
          }}
          title="Confirmar (Enter)"
          className="p-1 rounded text-emerald-400 hover:bg-emerald-950/60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>

        {onDelete && (
          <button
            onClick={() => {
              submittedRef.current = true;
              onDelete();
            }}
            title="Excluir texto"
            className="p-1 rounded text-rose-400 hover:bg-rose-950/60"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
