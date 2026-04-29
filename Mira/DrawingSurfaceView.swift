import AppKit

@MainActor
final class DrawingSurfaceView: NSView {
    private var state: AppState
    private var screenID: String
    private var currentPoints: [CGPoint] = []
    private var previewStroke: AnnotationStroke?
    private weak var activeTextField: InlineTextField?

    init(state: AppState, screenID: String) {
        self.state = state
        self.screenID = screenID
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var isOpaque: Bool { false }
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    func refresh(state: AppState, screenID: String) {
        self.state = state
        self.screenID = screenID
        needsDisplay = true
        window?.invalidateCursorRects(for: self)
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: state.drawingEnabled ? .crosshair : .arrow)
    }

    override func mouseDown(with event: NSEvent) {
        guard state.overlayVisible, state.drawingEnabled else { return }

        window?.makeFirstResponder(self)
        let point = convert(event.locationInWindow, from: nil)

        if state.currentTool == .text {
            beginTextEntry(at: point)
            return
        }

        currentPoints = [point]
        previewStroke = AnnotationStroke(
            screenID: screenID,
            tool: state.currentTool,
            color: state.selectedColor,
            width: state.lineWidth,
            points: state.currentTool == .pen ? [point] : [],
            start: state.currentTool == .pen ? nil : point,
            end: state.currentTool == .pen ? nil : point
        )
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard state.overlayVisible, state.drawingEnabled, var previewStroke else { return }

        var point = convert(event.locationInWindow, from: nil)
        if event.modifierFlags.contains(.shift), previewStroke.tool != .pen {
            point = constrainedPoint(from: previewStroke.start ?? point, to: point, tool: previewStroke.tool)
        }

        if previewStroke.tool == .pen {
            currentPoints.append(point)
            previewStroke.points = currentPoints
        } else {
            previewStroke.end = point
        }

        self.previewStroke = previewStroke
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        guard state.overlayVisible, state.drawingEnabled, var previewStroke else { return }

        if previewStroke.tool == .pen {
            if currentPoints.count > 1 {
                previewStroke.points = currentPoints
                state.commit(previewStroke)
            }
        } else if let start = previewStroke.start, let end = previewStroke.end, distance(from: start, to: end) > 0.5 {
            state.commit(previewStroke)
        }

        currentPoints.removeAll()
        self.previewStroke = nil
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        NSColor.clear.setFill()
        dirtyRect.fill()

        for stroke in state.strokes where stroke.screenID == screenID {
            draw(stroke)
        }

        if let previewStroke {
            draw(previewStroke)
        }
    }

    private func draw(_ stroke: AnnotationStroke) {
        stroke.color.nsColor.setStroke()
        stroke.color.nsColor.setFill()

        switch stroke.tool {
        case .pen:
            drawPen(stroke)
        case .line:
            drawLine(stroke)
        case .rectangle:
            drawRectangle(stroke)
        case .ellipse:
            drawEllipse(stroke)
        case .arrow:
            drawArrow(stroke)
        case .text:
            drawText(stroke)
        }
    }

    private func configuredPath(lineWidth: CGFloat) -> NSBezierPath {
        let path = NSBezierPath()
        path.lineWidth = lineWidth
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        return path
    }

    private func drawPen(_ stroke: AnnotationStroke) {
        guard let first = stroke.points.first, stroke.points.count > 1 else { return }
        let path = configuredPath(lineWidth: stroke.width)
        path.move(to: first)
        for point in stroke.points.dropFirst() {
            path.line(to: point)
        }
        path.stroke()
    }

    private func drawLine(_ stroke: AnnotationStroke) {
        guard let start = stroke.start, let end = stroke.end else { return }
        let path = configuredPath(lineWidth: stroke.width)
        path.move(to: start)
        path.line(to: end)
        path.stroke()
    }

    private func drawRectangle(_ stroke: AnnotationStroke) {
        guard let start = stroke.start, let end = stroke.end else { return }
        let path = NSBezierPath(rect: rect(from: start, to: end))
        path.lineWidth = stroke.width
        path.stroke()
    }

    private func drawEllipse(_ stroke: AnnotationStroke) {
        guard let start = stroke.start, let end = stroke.end else { return }
        let path = NSBezierPath(ovalIn: rect(from: start, to: end))
        path.lineWidth = stroke.width
        path.stroke()
    }

    private func drawArrow(_ stroke: AnnotationStroke) {
        guard let start = stroke.start, let end = stroke.end else { return }

        let path = configuredPath(lineWidth: stroke.width)
        path.move(to: start)
        path.line(to: end)
        path.stroke()

        let headLength = max(10, stroke.width * 3)
        let angle = atan2(end.y - start.y, end.x - start.x)
        let left = CGPoint(
            x: end.x - headLength * cos(angle - .pi / 6),
            y: end.y - headLength * sin(angle - .pi / 6)
        )
        let right = CGPoint(
            x: end.x - headLength * cos(angle + .pi / 6),
            y: end.y - headLength * sin(angle + .pi / 6)
        )

        let head = configuredPath(lineWidth: stroke.width)
        head.move(to: left)
        head.line(to: end)
        head.line(to: right)
        head.stroke()
    }

    private func drawText(_ stroke: AnnotationStroke) {
        guard let text = stroke.text, let position = stroke.position else { return }

        let fontSize = max(10, stroke.width * 3)
        let font = NSFont.systemFont(ofSize: fontSize, weight: .medium)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: stroke.color.nsColor
        ]
        let adjusted = CGPoint(x: position.x, y: position.y - fontSize / 2)
        NSString(string: text).draw(at: adjusted, withAttributes: attributes)
    }

    private func beginTextEntry(at point: CGPoint) {
        activeTextField?.finish(commit: true)

        let fontSize = max(10, state.lineWidth * 3)
        let textField = InlineTextField(
            frame: NSRect(x: point.x, y: point.y - fontSize / 2, width: 220, height: fontSize + 12)
        )
        textField.font = NSFont.systemFont(ofSize: fontSize, weight: .medium)
        textField.textColor = state.selectedColor.nsColor
        textField.placeholderString = "Type..."
        textField.onFinish = { [weak self, weak textField] commit in
            guard let self, let textField else { return }
            self.finishTextEntry(textField, at: point, commit: commit)
        }

        addSubview(textField)
        activeTextField = textField
        window?.makeFirstResponder(textField)
    }

    private func finishTextEntry(_ textField: InlineTextField, at point: CGPoint, commit: Bool) {
        let text = textField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if commit, !text.isEmpty {
            state.commit(
                AnnotationStroke(
                    screenID: screenID,
                    tool: .text,
                    color: state.selectedColor,
                    width: state.lineWidth,
                    text: text,
                    position: point
                )
            )
        }
        textField.removeFromSuperview()
        if activeTextField === textField {
            activeTextField = nil
        }
        window?.makeFirstResponder(self)
        needsDisplay = true
    }

    private func rect(from start: CGPoint, to end: CGPoint) -> CGRect {
        CGRect(
            x: min(start.x, end.x),
            y: min(start.y, end.y),
            width: abs(end.x - start.x),
            height: abs(end.y - start.y)
        )
    }

    private func distance(from start: CGPoint, to end: CGPoint) -> CGFloat {
        hypot(end.x - start.x, end.y - start.y)
    }

    private func constrainedPoint(from start: CGPoint, to end: CGPoint, tool: DrawingTool) -> CGPoint {
        let dx = end.x - start.x
        let dy = end.y - start.y

        switch tool {
        case .line, .arrow:
            let angle = atan2(dy, dx)
            let distance = hypot(dx, dy)
            let snappedAngle = round(angle / (.pi / 4)) * (.pi / 4)
            return CGPoint(
                x: start.x + cos(snappedAngle) * distance,
                y: start.y + sin(snappedAngle) * distance
            )
        case .rectangle, .ellipse:
            let maxDistance = max(abs(dx), abs(dy))
            return CGPoint(
                x: start.x + (dx >= 0 ? maxDistance : -maxDistance),
                y: start.y + (dy >= 0 ? maxDistance : -maxDistance)
            )
        case .pen, .text:
            return end
        }
    }
}

private final class InlineTextField: NSTextField {
    var onFinish: ((Bool) -> Void)?
    private var didFinish = false

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        configure()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configure()
    }

    private func configure() {
        isBordered = false
        isBezeled = false
        drawsBackground = false
        focusRingType = .none
        refusesFirstResponder = false
        lineBreakMode = .byClipping
    }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 36, 76:
            finish(commit: true)
        case 53:
            finish(commit: false)
        default:
            super.keyDown(with: event)
        }
    }

    override func resignFirstResponder() -> Bool {
        let result = super.resignFirstResponder()
        if result {
            finish(commit: true)
        }
        return result
    }

    func finish(commit: Bool) {
        guard !didFinish else { return }
        didFinish = true
        onFinish?(commit)
    }
}
