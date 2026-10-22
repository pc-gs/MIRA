# Changelog

All notable changes to Mira. There is no published release yet; everything below is on `main`.

## Unreleased

### Draw mode shortcuts
- One-key shortcuts while drawing: `1`–`6` colors (`⇧` for the highlighter), `P` `H` `E` `L` `A` `R` `O` `T` tools, `[` `]` size, `⌫` clear.
- Hold `L` `A` `R` `O` `E` while dragging to use that tool for one stroke.
- The cursor shows the current ink color and size.
- `?` opens a cheat sheet with every shortcut.

### Presenter mode
- With presenter mode on (`⌃⇧P`), the overlay stays click-through; hold `⌥` to draw fading marks and release to keep navigating.
- Cursor halo and optional click highlights (menu bar → Highlight Clicks).
- The eraser ring stays visible while hovering.

### Presenter tools
- Zoom (ZoomIt-style, `⌃⇧M`): freeze the monitor, magnify around the cursor, scroll to change level, drag to draw temporary ink.
- Laser pointer (`⌃⇧L`) with a fading trail.
- Highlighter on its own layer: even color where strokes overlap, under pen ink, yellow by default, `⇧` for a straight line.
- Fading ink (`⌃⇧F`).
- Toolbar hidden from screen sharing; menu bar icon; Open at Login; `⌃⇧H` hides the toolbar.
- Native vibrancy toolbar.

### Foundations
- Layered canvases, so drawing stays smooth with many strokes.
- Overlays for hot-plugged monitors, synced with the toolbar settings.
- Toolbar above the overlays (`NSStatusWindowLevel`).
- Global shortcuts on `⌃⇧`.
- CI ready for code signing and notarization once the Apple secrets are set.
