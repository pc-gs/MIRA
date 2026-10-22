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
- **Distribution**: CI is wired for Apple code signing and notarization (only active once the secrets are configured — see below).

---

## v1.1 — Presenter tools

Status: merged to `main`; builds on macOS CI. Waiting for hands-on testing on a Mac.

- **Zoom (ZoomIt-style)** — `Ctrl+Shift+M` freezes the current monitor and magnifies around the cursor; scroll changes level, drag draws temporary ink, Esc/right-click exits.
- **Laser pointer** — `Ctrl+Shift+L`, red dot with fading trail; overlay stays click-through.
- **Highlighter rework** — own layer (no darkening on overlap, under pen ink), yellow default with its own color, `Shift` for straight lines, eraser accounts for stroke width.
- **Fading ink** — `Ctrl+Shift+F`, strokes vanish after ~3 s without touching undo history.
- **Daily-use polish** — toolbar hidden from screen sharing, menu bar icon (monochrome template), Open at Login, `Ctrl+Shift+H` to hide the toolbar.
- **New look** — native vibrancy toolbar, grouped controls, zoom HUD.
- **Performance** — cursor updates no longer re-render the overlay.
- **Platform** — macOS only; Windows/Linux removed from CI; native Swift prototype removed.

---

## v1.2 — Presenter mode

Status: implemented, pending testing on macOS.

- **Hold ⌥ to draw** — with presenter mode on (`Ctrl+Shift+P`), the overlay stays click-through; holding Option switches the mouse to drawing (fading ink), releasing switches back instantly.
- **Cursor halo** and optional **click highlights** (tray → Highlight Clicks) for tutorials.
- **Eraser** — the eraser ring is now visible while hovering (it used to vanish).

---

## Pending

Known gaps from the v1.1 review, roughly in priority order.

### Needs a Mac (can't be verified in CI)
- **Hands-on test pass** — permissions prompts (Accessibility, Screen Recording), vibrancy/rounded corners on the toolbar, tray menu, Open at Login, and a real video call sharing the entire screen.
- **Zoom capture performance** — the snapshot travels as raw RGBA over IPC (tens of MB on 5K displays). If entering zoom feels slow, switch to JPEG encoding in `begin_zoom`.
- **Presenter mode feel** — verify ⌥ responsiveness (16 ms polling) and that typing ⌥ characters (e.g. `@` on the Portuguese layout) doesn't get in the way while presenter mode is on.
- **Highlighter strength on dark slides** — 40% opacity can look muted on dark backgrounds; consider 50–55% (`HIGHLIGHTER_ALPHA`).

### Distribution
- **Code signing & notarization** — needs an Apple Developer account and these repository secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`. Without them CI produces unsigned builds (fine for personal use; Gatekeeper will warn other users).
- **First release** — run the `Release Mira` workflow with a version (e.g. `v0.2.0`) to publish a `.dmg`.

### Technical debt / risks
- **Screen capture API** — `xcap` uses `CGWindowListCreateImage`, which Apple has deprecated. If a future macOS breaks it, move capture to ScreenCaptureKit (e.g. a small Swift/objc2 plugin).
- **Shortcut ergonomics** — `Ctrl+Shift+…` works but is awkward mid-call; revisit after real use (see shortcut customization below).
- **No automated tests** — drawing logic (`useDrawing.ts`) is the best candidate for unit tests if regressions start to appear.

---

## Future Ideas

### Core Experience
- **Shortcut customization UI** — Allow users to define their own global hotkeys.
- **Stroke Smoothing** — Simplification (e.g., Douglas-Peucker) or Bezier fitting for smoother pen lines.
- **Live magnifier** — A lens that follows the cursor showing the live screen (needs continuous capture).
- **Numbered markers** — Click to drop 1, 2, 3… badges for step-by-step explanations.

### Productivity
- **Stroke persistence** — Save/load annotation sessions to disk.
- **Shape editing** — Select, move, resize, and delete individual objects after they are drawn.
- **Screenshot/Export** — Quickly save the current annotations + screen to the clipboard or a file.

### Advanced
- **Presentation mode** — Auto-hide the toolbar after N seconds of inactivity, show on hover.
