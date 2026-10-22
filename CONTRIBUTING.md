# Contributing to Mira

Thanks for helping! Mira is a small macOS app, so the bar for a good contribution is simple: one focused change, explained, and checked on a Mac when it touches behavior.

## Setup

You need macOS, [Rust](https://rustup.rs) and [Bun](https://bun.sh).

```bash
git clone https://github.com/pc-gs/MIRA.git
cd MIRA
bun install
bun run tauri dev
```

In development, grant **Screen Recording** (for zoom) to the terminal app you run Mira from: System Settings → Privacy & Security.

## Before you open a pull request

```bash
bun run build                                        # TypeScript typecheck + frontend build
cargo check --manifest-path src-tauri/Cargo.toml     # Rust side
```

There is no automated test suite yet, so please also:

- Try the change in the running app, on more than one monitor if it touches windows or the cursor.
- Add a screenshot or a short GIF to the PR for anything visible.
- Keep the PR to one change. Two small PRs are easier to review than one big one.

## Where things live

- `src/components/Toolbar.tsx`: the floating toolbar. It owns the settings (tool, colors, size, modes).
- `src/components/Canvas.tsx` and `src/hooks/useDrawing.ts`: the overlay, one per monitor, which does the drawing.
- `src/lib/drawKeys.ts`: single-key shortcuts and the `?` cheat sheet.
- `src-tauri/src/lib.rs`: windows, global shortcuts, menu bar icon, cursor polling, presenter mode and screen capture.

[`CLAUDE.md`](CLAUDE.md) describes the event contract between the toolbar, Rust and the overlays in detail. Read it before adding a setting or a new event: every new toolbar setting must also be re-sent when an overlay asks for state.

## Platform

Mira is macOS-only for now. Keep code Tauri-portable and put macOS APIs behind `#[cfg(target_os = "macos")]`, but Windows/Linux support isn't a goal yet.

## Reporting bugs and ideas

Open an issue with the templates provided. For bugs, include your macOS version, how many monitors you use and the steps to reproduce.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
