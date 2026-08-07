import AppKit

extension NSWindow.Level {
    static let miraOverlay = NSWindow.Level.screenSaver
    static let miraToolbar = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 1)
}
