# GEMINI.md

This file provides context and guidelines for Gemini CLI when working in the Mira repository.

## Project Overview

Mira is a lightweight desktop annotation overlay for live presentations, demos, and teaching. It allows users to draw on top of any application, highlight points with a spotlight, and manage annotations via a floating toolbar.

- **Tech Stack:** Tauri 2 (Rust backend), React 19 + TypeScript (Frontend), Vite (Build tool), Bun (Package manager), Tailwind CSS 4 (Styling).
- **Architecture:** Split-window design.
    - `toolbar` window: Compact floating controller for tools and settings.
    - `overlay*` windows: Transparent, always-on-top, per-monitor drawing surfaces.
    - **Communication:** Frontend windows use `invoke` to call Rust commands. Rust emits events (e.g., `cursor-moved`, `shortcut-*`) back to the windows. A bridge command `emit_to_overlay` allows the toolbar to communicate with overlays via the backend.

## Building and Running

### Prerequisites
- [Rust](https://rustup.rs/)
- [Bun](https://bun.sh/)
- macOS (Primary target, requires Accessibility permissions for global shortcuts)

### Development
```bash
# Install dependencies
bun install

# Start full dev environment (Tauri + Vite frontend)
bun run tauri dev

# Frontend only development (Vite)
bun run dev
```

### Build
```bash
# Build production application
bun run tauri build
```

### Backend (Rust)
Commands should be run from the `src-tauri/` directory:
```bash
cargo check   # Check Rust code
cargo clippy  # Lint Rust code
cargo test    # Run Rust tests
```

## Development Conventions

- **Package Manager:** Always use `bun`.
- **Styling:** Uses Tailwind CSS 4 with the Vite plugin. Prefer utility classes for styling.
- **Window Routing:** `src/App.tsx` routes to components based on the Tauri window label (`overlay` vs `toolbar`).
- **Events:** 
    - Use `emit_to_overlay` Rust command to send events from the toolbar to all overlay windows.
    - Listen for `cursor-moved` events in the canvas for spotlight/pointer functionality.
- **Shortcuts:** Global shortcuts are registered in Rust (`src-tauri/src/lib.rs`) and emitted as events to the frontend.

## Key Files
- `src-tauri/src/lib.rs`: Main Rust logic, window management, and command handlers.
- `src-tauri/tauri.conf.json`: Tauri configuration including window definitions and permissions.
- `src/App.tsx`: Frontend entry point and window router.
- `src/components/Toolbar.tsx`: The floating toolbar UI and tool selection logic.
- `src/components/Canvas.tsx`: The drawing surface and annotation rendering logic.
- `src/hooks/useDrawing.ts`: Custom hook managing the drawing state and canvas operations.
- `CLAUDE.md`: Additional technical guidelines for AI assistants.

## Keyboard Shortcuts (macOS)
- `Ctrl+Shift+X`: Toggle overlay on/off
- `Ctrl+Shift+D`: Toggle draw mode
- `Ctrl+Shift+C`: Clear canvas
- `Ctrl+Shift+Z`: Undo
- `Ctrl+Shift+Y`: Redo
- `Ctrl+Shift+S`: Toggle spotlight
