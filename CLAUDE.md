# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mira is a desktop annotation overlay (draw on top of any app during presentations). The primary app is **Tauri 2 (Rust) + React 19 + TypeScript + Vite + Tailwind v4**, using **Bun** as package manager. **macOS only**: CI builds only macOS, and screen capture (zoom) is `#[cfg(target_os = "macos")]`. Keep the code Tauri-portable, but don't spend effort on Windows/Linux.

The repo also contains a separate **native macOS SwiftUI/AppKit implementation** in `Mira/` + `Mira.xcodeproj`. It is independent of the Tauri app (its own `AppState`, overlay/toolbar window controllers, `ShortcutManager`) and shares no code with it. Don't assume a change in one should be mirrored in the other unless asked.

## Commands

```bash
bun install               # install JS deps
bun run tauri dev         # run the desktop app (starts Vite on :1420 via beforeDevCommand)
bun run tauri build       # production bundle -> src-tauri/target/release/bundle/
bun run build             # frontend only: tsc typecheck + vite build (this is the de facto lint/typecheck)
cargo check --manifest-path src-tauri/Cargo.toml   # check Rust side (on a Mac)
```

From a Linux container (no webkit2gtk), the Rust side can still be type-checked against macOS:

```bash
rustup target add aarch64-apple-darwin
CC_aarch64_apple_darwin=clang CFLAGS_aarch64_apple_darwin="--target=arm64-apple-macos11" AR_aarch64_apple_darwin=llvm-ar \
  cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin
```

There is no test suite, ESLint, or Prettier config. Vite dev server uses `strictPort: true` on 1420 — dev fails if the port is taken.

## Architecture

**One frontend bundle, multiple windows.** `src/App.tsx` routes by Tauri window label: labels starting with `overlay` render `<Canvas />`, label `toolbar` renders `<Toolbar />`.

- `toolbar` — small floating controller window; owns the UI state (tool, per-tool color — pen and highlighter have separate colors —, size, draw mode, pointer mode `off|laser|spotlight`, visibility).
- `overlay`, `overlay-N`, `overlay-dyn-N` — one transparent, always-on-top, full-monitor window per display. Each owns its own strokes and undo history (`src/hooks/useDrawing.ts`). Overlays start in click-through mode (`set_ignore_cursor_events(true)`).

Both static windows are declared in `src-tauri/tauri.conf.json`; extra monitor overlays are created in Rust (`setup_windows`, and hot-plugged ones in the polling thread). The capability file `src-tauri/capabilities/default.json` matches `overlay*` — keep new overlay labels within that prefix, since `overlay_labels()` in Rust also relies on it.

**Communication flow (all in `src-tauri/src/lib.rs`):**
- Toolbar → overlays: toolbar calls `invoke("emit_to_overlay", { event, payload })`; Rust re-emits to every overlay window. Events: `drawing-toggled`, `tool-changed`, `color-changed` (color of the active tool; re-sent on tool change), `size-changed`, `pointer-mode-changed`, `zoom-toggle`, `shortcut-clear/undo/redo`.
- Toolbar → window management: `set_overlay_visible`, `set_overlay_passthrough` (draw mode = passthrough off), `set_toolbar_size`/`set_toolbar_width`, `save_toolbar_position`/`reset_toolbar_position` (persisted as `toolbar-position.json` in app data dir, clamped to monitor work area), `quit_app`.
- Overlay → toolbar state sync: a newly mounted overlay emits `request-state`; the toolbar responds by re-broadcasting all current settings. Any new toolbar setting must be added to that handler or new/hot-plugged overlays will be out of sync.
- Global shortcuts (`Ctrl+Shift+X/D/C/Z/Y/S/L/M`) are registered in Rust. Toggle/draw/spotlight/laser are emitted to the `toolbar` (which owns that state); clear/undo/redo and `zoom-toggle` go directly to overlays. Overlays emit `overlay-escape` (Esc in draw mode) back to the toolbar. Registration failure (e.g. missing macOS Accessibility permission) is logged, not fatal.
- A background Rust thread polls every 16 ms: emits `cursor-moved` (converted to each overlay's logical coords) and every 2 s checks for newly connected monitors to spawn overlays. On the frontend, `useCursorStream` keeps the cursor in a ref with subscribers (no React state) — spotlight and laser update imperatively; don't put `cursor-moved` into `useState`.
- Zoom: `zoom-toggle` goes to every overlay; only the one whose window contains the cursor (or that is already zoomed) reacts. `ZoomView` calls `begin_zoom` (captures the overlay's monitor with `xcap`, turns off click-through, focuses the window; returns `[w u32 LE][h u32 LE][RGBA]` as a binary `ipc::Response`) and `end_zoom(passThrough)` on unmount. Zoom drawings are temporary and not part of the stroke history.
- New Rust commands must be added to `tauri::generate_handler![...]` in `run()`.

**macOS window level:** the toolbar is raised to `NSStatusWindowLevel` via `objc2` so it stays above overlays (`raise_toolbar`). Platform-specific code is behind `#[cfg(target_os = "macos")]`; `macOSPrivateApi` is enabled for transparency.

**Drawing (`useDrawing.ts`):** layered canvases — committed highlighter strokes go to a highlight layer drawn at full alpha with CSS `opacity: HIGHLIGHTER_ALPHA` (so overlaps don't darken, and ink sits on top); other committed strokes go to the background canvas; the in-progress stroke/preview goes to a foreground canvas (which receives pointer events). State lives in refs (`strokesRef`, `pastRef`/`futureRef` snapshot stacks for undo/redo), not React state, to avoid re-renders while drawing. Strokes are plain data (`src/types/index.ts`): freehand tools use `points`, shapes use `start`/`end`, text uses `text`/`position`. Eraser removes whole strokes by hit-testing and pushes a single history entry per gesture; clear is also undoable. Shift constrains lines/arrows to 45° and rect/ellipse to squares.

## Release / versioning

`.github/workflows/build.yml` builds macOS on PRs/pushes to `main`. `release.yml` is manual (`workflow_dispatch` with a version input); it bumps only `src-tauri/Cargo.toml` and tags. Version strings in `package.json` and `tauri.conf.json` are not kept in sync automatically.
