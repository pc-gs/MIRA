# Next Steps

Track of planned improvements across upcoming milestones.

---

## v1.0 — Release Ready

Status: completed.

- **Performance Optimization**: Implemented dual-canvas rendering (background/foreground) to eliminate lag during complex drawing sessions.
- **Dynamic Multi-monitor Support**: Added backend polling to automatically spawn overlays when new displays are connected (hot-plugging).
- **State Synchronization**: New overlays now automatically sync with the current toolbar settings (color, tool, size) on mount.
- **macOS Polish**: Fixed Z-order issues by elevating the toolbar to `NSStatusWindowLevel` (stays above drawings).
- **Unified Shortcuts**: Standardized on `Ctrl+Shift` modifiers to avoid conflicts with macOS Dock and browser developer tools.
- **Distribution**: Added Apple Code Signing and Notarization support to the CI/CD pipeline.

---

## v1.1 — Presenter tools

Status: implemented, pending testing on macOS.

- **Zoom (ZoomIt-style)** — `Ctrl+Shift+M` freezes the current monitor and magnifies around the cursor; scroll changes level, drag draws temporary ink, Esc/right-click exits.
- **Laser pointer** — `Ctrl+Shift+L`, red dot with fading trail; overlay stays click-through.
- **Highlighter rework** — own layer (no darkening on overlap, under pen ink), yellow default with its own color, `Shift` for straight lines, eraser accounts for stroke width.
- **Fading ink** — `Ctrl+Shift+F`, strokes vanish after ~3 s without touching undo history.
- **Daily-use polish** — toolbar hidden from screen sharing, menu bar icon, Open at Login, `Ctrl+Shift+H` to hide the toolbar.
- **Performance** — cursor updates no longer re-render the overlay.
- **Platform** — macOS only; Windows/Linux removed from CI.

---

## Future Ideas

### Core Experience
- **Shortcut customization UI** — Allow users to define their own global hotkeys in the toolbar settings.
- **Stroke Smoothing** — Implement simplification algorithms (e.g., Douglas-Peucker) or Bezier curves for smoother pen lines.
- **Snap/constraints** — Hold `Shift` for straight-angle lines and proportional rectangles/ellipses.

### Productivity
- **Text annotations** — Add floating text labels on the overlay.
- **Stroke persistence** — Save/load annotation sessions to disk.
- **Shape editing** — Select, move, resize, and delete individual objects after they are drawn.
- **Screenshot/Export** — Quickly save the current annotations + screen to the clipboard or a file.

### Advanced
- **Toolbar variants** — Auto-collapse on inactivity or "mini" mode for cleaner presentations.
- **Presentation mode** — Auto-hide toolbar after N seconds of inactivity, show on hover.
