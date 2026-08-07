import { useState } from "react";

export interface ShortcutConfig {
  toggleOverlay: string;
  toggleDraw: string;
  clearCanvas: string;
  undo: string;
  redo: string;
  spotlight: string;
}

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
  toggleOverlay: "Ctrl+Shift+X",
  toggleDraw: "Ctrl+Shift+D",
  clearCanvas: "Ctrl+Shift+C",
  undo: "Ctrl+Shift+Z",
  redo: "Ctrl+Shift+Y",
  spotlight: "Ctrl+Shift+S",
};

interface HotkeyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HotkeyModal({ isOpen, onClose }: HotkeyModalProps) {
  const [shortcuts, setShortcuts] = useState<ShortcutConfig>(() => {
    try {
      const saved = localStorage.getItem("mira_shortcuts");
      return saved ? JSON.parse(saved) : DEFAULT_SHORTCUTS;
    } catch {
      return DEFAULT_SHORTCUTS;
    }
  });

  const [recordingAction, setRecordingAction] = useState<keyof ShortcutConfig | null>(null);

  if (!isOpen) return null;

  const handleSave = () => {
    try {
      localStorage.setItem("mira_shortcuts", JSON.stringify(shortcuts));
    } catch (err) {
      console.error("Failed to save shortcuts", err);
    }
    onClose();
  };

  const handleReset = () => {
    setShortcuts(DEFAULT_SHORTCUTS);
    try {
      localStorage.setItem("mira_shortcuts", JSON.stringify(DEFAULT_SHORTCUTS));
    } catch (err) {
      console.error("Failed to reset shortcuts", err);
    }
  };

  const handleRecordKey = (action: keyof ShortcutConfig, e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");

    const key = e.key.toUpperCase();
    if (!["CONTROL", "SHIFT", "ALT", "META"].includes(key)) {
      parts.push(key);
      const shortcutStr = parts.join("+");
      setShortcuts((prev) => ({ ...prev, [action]: shortcutStr }));
      setRecordingAction(null);
    }
  };

  const SHORTCUT_LABELS: Record<keyof ShortcutConfig, string> = {
    toggleOverlay: "Alternar Visibilidade da Tela",
    toggleDraw: "Alternar Modo Caneta",
    clearCanvas: "Limpar Tela Inteira",
    undo: "Desfazer Útilmo Desenho",
    redo: "Refazer Desenho",
    spotlight: "Alternar Spotlight / Pointer",
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center select-none"
      onClick={onClose}
    >
      <div
        className="w-[420px] bg-neutral-900 border border-neutral-700/80 rounded-2xl p-5 shadow-2xl text-white space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Personalizar Atalhos
          </h2>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-white rounded">
            ✕
          </button>
        </div>

        <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
          {(Object.keys(SHORTCUT_LABELS) as Array<keyof ShortcutConfig>).map((key) => (
            <div key={key} className="flex items-center justify-between text-sm py-1.5 border-b border-neutral-800/50">
              <span className="text-neutral-300 font-medium">{SHORTCUT_LABELS[key]}</span>
              <button
                tabIndex={0}
                onClick={() => setRecordingAction(key)}
                onKeyDown={(e) => {
                  if (recordingAction === key) handleRecordKey(key, e);
                }}
                className={`px-3 py-1 text-xs font-mono rounded-md border transition-all ${
                  recordingAction === key
                    ? "bg-blue-600 border-blue-400 text-white animate-pulse"
                    : "bg-neutral-800 border-neutral-700 text-neutral-200 hover:border-neutral-500"
                }`}
              >
                {recordingAction === key ? "Pressione as teclas..." : shortcuts[key]}
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-neutral-800">
          <button
            onClick={handleReset}
            className="text-xs text-rose-400 hover:text-rose-300 transition-colors"
          >
            Restaurar Padrões
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 rounded-lg"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg shadow-md"
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
