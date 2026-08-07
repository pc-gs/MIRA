import AppKit
import Combine

@MainActor
final class AppState: ObservableObject {
    static let presetColors: [PresetInk] = [
        PresetInk(id: "white", name: "White", color: RGBAColor(hex: 0xffffff)),
        PresetInk(id: "red", name: "Red", color: RGBAColor(hex: 0xef4444)),
        PresetInk(id: "orange", name: "Orange", color: RGBAColor(hex: 0xf97316)),
        PresetInk(id: "yellow", name: "Yellow", color: RGBAColor(hex: 0xeab308)),
        PresetInk(id: "green", name: "Green", color: RGBAColor(hex: 0x22c55e)),
        PresetInk(id: "blue", name: "Blue", color: RGBAColor(hex: 0x3b82f6))
    ]

    static let lineWidths: [CGFloat] = [3, 6, 12]

    var overlayVisibilityChanged: ((Bool) -> Void)?
    var drawingModeChanged: ((Bool) -> Void)?

    @Published var overlayVisible = true {
        didSet {
            guard overlayVisible != oldValue else { return }
            overlayVisibilityChanged?(overlayVisible)
            if !overlayVisible {
                drawingEnabled = false
            }
        }
    }

    @Published var drawingEnabled = false {
        didSet {
            guard drawingEnabled != oldValue else { return }
            drawingModeChanged?(drawingEnabled)
        }
    }

    @Published var currentTool: DrawingTool = .pen
    @Published var selectedColor = AppState.presetColors[0].color
    @Published var lineWidth = AppState.lineWidths[1]
    @Published var spotlightEnabled = false
    @Published private(set) var strokes: [AnnotationStroke] = []

    private var redoStack: [AnnotationStroke] = []

    func toggleOverlay() {
        overlayVisible.toggle()
    }

    func toggleDrawing() {
        if !overlayVisible {
            overlayVisible = true
        }
        drawingEnabled.toggle()
    }

    func toggleSpotlight() {
        if !overlayVisible {
            overlayVisible = true
        }
        spotlightEnabled.toggle()
    }

    func togglePen() {
        if drawingEnabled && currentTool == .pen {
            drawingEnabled = false
        } else {
            if !overlayVisible {
                overlayVisible = true
            }
            currentTool = .pen
            drawingEnabled = true
        }
    }

    func selectTool(_ tool: DrawingTool) {
        if !overlayVisible {
            overlayVisible = true
        }
        currentTool = tool
        drawingEnabled = true
    }

    func selectColor(_ color: RGBAColor) {
        selectedColor = color
    }

    func selectLineWidth(_ width: CGFloat) {
        lineWidth = width
    }

    func commit(_ stroke: AnnotationStroke) {
        strokes.append(stroke)
        redoStack.removeAll()
    }

    func undo() {
        guard let last = strokes.popLast() else { return }
        redoStack.append(last)
    }

    func redo() {
        guard let stroke = redoStack.popLast() else { return }
        strokes.append(stroke)
    }

    func clear() {
        strokes.removeAll()
        redoStack.removeAll()
    }
}
