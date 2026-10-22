import { SHORTCUT_SHEET } from "../lib/drawKeys";

const PANEL_STYLE: React.CSSProperties = {
  background: "rgba(24,24,27,0.9)",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1), 0 24px 60px -12px rgba(0,0,0,0.65)",
  backdropFilter: "blur(16px)",
  fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
};

/** Keyboard cheat sheet shown over the canvas with "?" in draw mode. */
export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center" onPointerDown={onClose}>
      <div
        className="grid grid-cols-2 gap-x-10 gap-y-6 px-8 py-7 rounded-3xl text-zinc-100 select-none"
        style={PANEL_STYLE}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {SHORTCUT_SHEET.map((section) => (
          <div key={section.title} className="min-w-[260px]">
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
              {section.title}
            </div>
            <div className="flex flex-col gap-1.5">
              {section.rows.map(([keys, label]) => (
                <div key={keys} className="flex items-baseline justify-between gap-6 text-[13px]">
                  <span className="text-zinc-300">{label}</span>
                  <kbd className="flex-shrink-0 px-1.5 py-0.5 rounded-md bg-white/10 text-[12px] text-zinc-100 font-medium">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="col-span-2 text-center text-[12px] text-zinc-500">
          Press ? or Esc to close
        </div>
      </div>
    </div>
  );
}

/** Brief pill reminding that "?" opens the cheat sheet. */
export function ShortcutHint() {
  return (
    <div
      className="pointer-events-none fixed bottom-10 left-1/2 -translate-x-1/2 px-3.5 py-2 rounded-full text-[12px] text-zinc-200"
      style={PANEL_STYLE}
    >
      Press <kbd className="px-1 rounded bg-white/15 font-medium">?</kbd> for shortcuts
    </div>
  );
}
