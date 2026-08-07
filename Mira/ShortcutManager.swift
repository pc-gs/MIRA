import AppKit

@MainActor
final class ShortcutManager {
    private weak var state: AppState?
    private var globalMonitor: Any?
    private var localMonitor: Any?

    init(state: AppState) {
        self.state = state
    }

    func start() {
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            Task { @MainActor in
                _ = self?.handle(event)
            }
        }

        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            return self.handle(event) ? nil : event
        }
    }

    @discardableResult
    private func handle(_ event: NSEvent) -> Bool {
        guard let state, !event.isARepeat, isMiraShortcut(event) else { return false }

        switch event.charactersIgnoringModifiers?.lowercased() {
        case "x":
            state.toggleOverlay()
        case "d":
            state.toggleDrawing()
        case "c":
            state.clear()
        case "z":
            state.undo()
        case "y":
            state.redo()
        case "s":
            state.toggleSpotlight()
        default:
            return false
        }

        return true
    }

    private func isMiraShortcut(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        return flags.contains(.command)
            && flags.contains(.shift)
            && !flags.contains(.option)
            && !flags.contains(.control)
    }
}
