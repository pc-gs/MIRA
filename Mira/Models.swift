import AppKit
import SwiftUI

enum DrawingTool: String, CaseIterable, Identifiable {
    case pen
    case line
    case rectangle
    case ellipse
    case arrow
    case text

    var id: String { rawValue }

    var symbolName: String {
        switch self {
        case .pen:
            "pencil.tip"
        case .line:
            "line.diagonal"
        case .rectangle:
            "rectangle"
        case .ellipse:
            "oval"
        case .arrow:
            "arrow.up.right"
        case .text:
            "textformat"
        }
    }

    var helpTitle: String {
        switch self {
        case .pen:
            "Pen"
        case .line:
            "Line"
        case .rectangle:
            "Rectangle"
        case .ellipse:
            "Ellipse"
        case .arrow:
            "Arrow"
        case .text:
            "Text"
        }
    }
}

struct RGBAColor: Codable, Equatable {
    var red: CGFloat
    var green: CGFloat
    var blue: CGFloat
    var alpha: CGFloat

    init(red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    init(hex: UInt32) {
        red = CGFloat((hex >> 16) & 0xff) / 255
        green = CGFloat((hex >> 8) & 0xff) / 255
        blue = CGFloat(hex & 0xff) / 255
        alpha = 1
    }

    var nsColor: NSColor {
        NSColor(red: red, green: green, blue: blue, alpha: alpha)
    }

    var swiftUIColor: Color {
        Color(red: red, green: green, blue: blue, opacity: alpha)
    }
}

struct PresetInk: Identifiable, Equatable {
    let id: String
    let name: String
    let color: RGBAColor
}

struct AnnotationStroke: Identifiable, Equatable {
    var id = UUID()
    var screenID: String
    var tool: DrawingTool
    var color: RGBAColor
    var width: CGFloat
    var points: [CGPoint] = []
    var start: CGPoint?
    var end: CGPoint?
    var text: String?
    var position: CGPoint?
}

struct ScreenDescriptor: Identifiable, Equatable {
    let id: String
    let name: String
    let frame: CGRect

    init(screen: NSScreen) {
        let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        id = screenNumber?.stringValue ?? "\(screen.frame.origin.x)-\(screen.frame.origin.y)-\(screen.frame.width)-\(screen.frame.height)"
        name = screen.localizedName
        frame = screen.frame
    }
}

enum ToolbarMetrics {
    static let width: CGFloat = 514
    static let height: CGFloat = 54
    static let cornerRadius: CGFloat = 8
}
