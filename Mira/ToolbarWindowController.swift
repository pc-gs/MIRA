import AppKit
import SwiftUI

@MainActor
final class ToolbarWindowController: NSObject {
    private enum DefaultsKey {
        static let toolbarX = "Mira.toolbarX"
        static let toolbarY = "Mira.toolbarY"
    }

    private let state: AppState
    private let contentSize = NSSize(width: ToolbarMetrics.width, height: ToolbarMetrics.height)
    private var panel: NSPanel?

    init(state: AppState) {
        self.state = state
        super.init()
        createPanel()
    }

    func show() {
        panel?.orderFrontRegardless()
    }

    func resetPosition() {
        UserDefaults.standard.removeObject(forKey: DefaultsKey.toolbarX)
        UserDefaults.standard.removeObject(forKey: DefaultsKey.toolbarY)
        panel?.setFrameOrigin(defaultOrigin())
        savePosition()
    }

    func clampToVisibleScreen() {
        guard let panel else { return }
        panel.setFrameOrigin(clamped(origin: panel.frame.origin))
        savePosition()
    }

    private func createPanel() {
        let panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: contentSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .miraToolbar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.acceptsMouseMovedEvents = true
        panel.isMovableByWindowBackground = true
        panel.isReleasedWhenClosed = false

        let rootView = ToolbarView(
            state: state,
            resetToolbar: { [weak self] in self?.resetPosition() },
            quit: { NSApp.terminate(nil) }
        )
        let hostingView = ToolbarHostingView(rootView: rootView)
        hostingView.frame = NSRect(origin: .zero, size: contentSize)
        panel.contentView = hostingView
        panel.setFrameOrigin(savedOrigin() ?? defaultOrigin())

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(windowDidMove),
            name: NSWindow.didMoveNotification,
            object: panel
        )

        self.panel = panel
    }

    @objc private func windowDidMove() {
        savePosition()
    }

    private func savePosition() {
        guard let origin = panel?.frame.origin else { return }
        UserDefaults.standard.set(Double(origin.x), forKey: DefaultsKey.toolbarX)
        UserDefaults.standard.set(Double(origin.y), forKey: DefaultsKey.toolbarY)
    }

    private func savedOrigin() -> CGPoint? {
        guard
            UserDefaults.standard.object(forKey: DefaultsKey.toolbarX) != nil,
            UserDefaults.standard.object(forKey: DefaultsKey.toolbarY) != nil
        else {
            return nil
        }

        let x = UserDefaults.standard.double(forKey: DefaultsKey.toolbarX)
        let y = UserDefaults.standard.double(forKey: DefaultsKey.toolbarY)
        return clamped(origin: CGPoint(x: x, y: y))
    }

    private func defaultOrigin() -> CGPoint {
        let visibleFrame = NSScreen.main?.visibleFrame ?? NSScreen.screens.first?.visibleFrame ?? .zero
        let x = visibleFrame.midX - contentSize.width / 2
        let y = visibleFrame.maxY - contentSize.height - 24
        return clamped(origin: CGPoint(x: x, y: y))
    }

    private func clamped(origin: CGPoint) -> CGPoint {
        let screen = NSScreen.screens.first { $0.visibleFrame.insetBy(dx: -80, dy: -80).contains(origin) }
            ?? NSScreen.main
            ?? NSScreen.screens.first
        guard let visibleFrame = screen?.visibleFrame else { return origin }

        let minX = visibleFrame.minX + 8
        let maxX = visibleFrame.maxX - contentSize.width - 8
        let minY = visibleFrame.minY + 8
        let maxY = visibleFrame.maxY - contentSize.height - 8

        return CGPoint(
            x: min(max(origin.x, minX), maxX),
            y: min(max(origin.y, minY), maxY)
        )
    }
}

private final class ToolbarHostingView<Content: View>: NSHostingView<Content> {
    override var mouseDownCanMoveWindow: Bool {
        true
    }
}
