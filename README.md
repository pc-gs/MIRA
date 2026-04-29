# Mira

Mira is a native macOS screen annotation overlay built with SwiftUI and AppKit.

It is designed for live demos, teaching sessions, walkthroughs, and screen shares where you need quick drawing tools without switching away from the app you are presenting.

## Features

- Transparent always-on-top overlay windows across connected displays
- Floating native toolbar
- Pen, line, rectangle, ellipse, arrow, and text tools
- Color and stroke-size controls
- Spotlight mode for cursor emphasis
- Undo, redo, and clear
- Click-through overlay mode when drawing is disabled
- Menu bar controls
- Global shortcuts

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+Shift+X` | Toggle overlay visibility |
| `Cmd+Shift+D` | Toggle drawing mode |
| `Cmd+Shift+C` | Clear annotations |
| `Cmd+Shift+Z` | Undo |
| `Cmd+Shift+Y` | Redo |
| `Cmd+Shift+S` | Toggle spotlight |

macOS may require Accessibility permission for global keyboard monitoring.

## Requirements

- macOS 13 or later
- Xcode 16 or later for local development

## Build Locally

Open `Mira.xcodeproj` in Xcode and build the `Mira` scheme.

From the command line:

```sh
xcodebuild \
  -project Mira.xcodeproj \
  -scheme Mira \
  -configuration Release \
  -destination 'platform=macOS' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Development

The app uses AppKit for transparent overlay windows and pointer-level drawing, while SwiftUI powers the floating toolbar and popover controls.
