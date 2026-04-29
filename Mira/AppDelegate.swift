import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let state = AppState()
    private var overlayController: OverlayWindowController?
    private var toolbarController: ToolbarWindowController?
    private var shortcutManager: ShortcutManager?
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        let overlays = OverlayWindowController(state: state)
        let toolbar = ToolbarWindowController(state: state)
        let shortcuts = ShortcutManager(state: state)

        state.overlayVisibilityChanged = { [weak overlays] visible in
            overlays?.setVisible(visible)
        }
        state.drawingModeChanged = { [weak overlays] enabled in
            overlays?.setDrawingEnabled(enabled)
        }

        overlayController = overlays
        toolbarController = toolbar
        shortcutManager = shortcuts

        overlays.start()
        toolbar.show()
        shortcuts.start()
        installStatusMenu()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenParametersChanged),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    @objc private func screenParametersChanged() {
        overlayController?.rebuild()
        toolbarController?.clampToVisibleScreen()
    }

    private func installStatusMenu() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(
            systemSymbolName: "pencil.and.scribble",
            accessibilityDescription: "Mira"
        )

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Toggle Overlay", action: #selector(toggleOverlay), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Toggle Drawing", action: #selector(toggleDrawing), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Toggle Spotlight", action: #selector(toggleSpotlight), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Clear Annotations", action: #selector(clearAnnotations), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Reset Toolbar Position", action: #selector(resetToolbarPosition), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Mira", action: #selector(quit), keyEquivalent: "q"))

        for menuItem in menu.items {
            menuItem.target = self
        }

        item.menu = menu
        statusItem = item
    }

    @objc private func toggleOverlay() {
        state.toggleOverlay()
    }

    @objc private func toggleDrawing() {
        state.toggleDrawing()
    }

    @objc private func toggleSpotlight() {
        state.toggleSpotlight()
    }

    @objc private func clearAnnotations() {
        state.clear()
    }

    @objc private func resetToolbarPosition() {
        toolbarController?.resetPosition()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
