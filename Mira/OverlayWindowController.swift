import AppKit
import SwiftUI

@MainActor
final class OverlayWindowController {
    private let state: AppState
    private var windows: [String: NSWindow] = [:]

    init(state: AppState) {
        self.state = state
    }

    func start() {
        rebuild()
    }

    func rebuild() {
        for window in windows.values {
            window.orderOut(nil)
        }
        windows.removeAll()

        for screen in NSScreen.screens {
            createOverlay(for: ScreenDescriptor(screen: screen))
        }

        setVisible(state.overlayVisible)
        setDrawingEnabled(state.drawingEnabled)
    }

    func setVisible(_ visible: Bool) {
        for window in windows.values {
            if visible {
                window.orderFrontRegardless()
            } else {
                window.orderOut(nil)
            }
        }
    }

    func setDrawingEnabled(_ enabled: Bool) {
        for window in windows.values {
            window.ignoresMouseEvents = !enabled
        }
    }

    private func createOverlay(for screen: ScreenDescriptor) {
        let window = NSWindow(
            contentRect: screen.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.level = .miraOverlay
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = false
        window.acceptsMouseMovedEvents = true
        window.ignoresMouseEvents = !state.drawingEnabled
        window.setFrame(screen.frame, display: true)

        let rootView = OverlayRootView(state: state, screen: screen)
        let hostingView = NSHostingView(rootView: rootView)
        hostingView.frame = NSRect(origin: .zero, size: screen.frame.size)
        hostingView.wantsLayer = true
        hostingView.layer?.backgroundColor = NSColor.clear.cgColor
        window.contentView = hostingView

        windows[screen.id] = window
    }
}
