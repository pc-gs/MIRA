# Roadmap

Known gaps and ideas. Want to help with one? Open an issue first so we can agree on the approach.

## Needs a Mac to verify
- **Hands-on test pass**: permission prompts (Screen Recording), the toolbar's vibrancy and rounded corners, the menu bar icon, Open at Login, and a real video call sharing the entire screen.
- **Global shortcut permissions**: check whether the `⌃⇧` shortcuts really need Accessibility (the plugin uses Carbon hotkeys, which usually don't), and fix the README either way.
- **Zoom capture speed**: the snapshot travels as raw RGBA over IPC (tens of MB on 5K displays). If entering zoom feels slow, encode it in `begin_zoom`.
- **Highlighter on dark slides**: 40% opacity can look muted; consider 50–55% (`HIGHLIGHTER_ALPHA`).

## Distribution
- **Code signing and notarization**: needs an Apple Developer account and the `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` repository secrets. Without them CI builds are unsigned and Gatekeeper warns.
- **First release**: run the `Release Mira` workflow to publish a `.dmg`.

## Technical debt
- **Screen capture API**: `xcap` uses `CGWindowListCreateImage`, which Apple deprecated. Move to ScreenCaptureKit if a future macOS breaks it.
- **Tests**: the drawing logic in `useDrawing.ts` is the best first candidate for unit tests.

## Ideas
- Shortcut customization.
- Stroke smoothing (coalesced pointer events, Douglas-Peucker or Bézier fitting).
- A real spotlight that dims the rest of the screen.
- Whiteboard / blackboard background.
- Copy the screen with annotations to the clipboard.
- Numbered markers (1, 2, 3…) for step-by-step explanations.
- Select, move and resize shapes after drawing them.
- Save and load annotation sessions.
- Live magnifier lens that follows the cursor.
- Auto-hide the toolbar after a few seconds without use.
