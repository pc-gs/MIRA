import SwiftUI

struct ToolbarView: View {
    @ObservedObject var state: AppState
    let resetToolbar: () -> Void
    let quit: () -> Void

    @State private var isShowingShapePicker = false
    @State private var isShowingColorPicker = false

    private var shapeTools: [DrawingTool] {
        DrawingTool.allCases.filter { $0 != .pen }
    }

    private var currentShapeTool: DrawingTool {
        shapeTools.contains(state.currentTool) ? state.currentTool : .line
    }

    var body: some View {
        HStack(spacing: 5) {
            dragHandle

            toolbarButton(
                symbol: state.overlayVisible ? "eye" : "eye.slash",
                active: state.overlayVisible,
                help: "Toggle Overlay (Cmd+Shift+X)",
                action: state.toggleOverlay
            )

            separator

            toolbarButton(
                symbol: DrawingTool.pen.symbolName,
                active: state.drawingEnabled && state.currentTool == .pen,
                enabled: state.overlayVisible,
                help: "Pen",
                action: state.togglePen
            )

            toolbarButton(
                symbol: "viewfinder.circle",
                active: state.spotlightEnabled,
                enabled: state.overlayVisible,
                help: "Spotlight (Cmd+Shift+S)",
                action: state.toggleSpotlight
            )

            shapeMenu

            separator

            colorMenu

            separator

            HStack(spacing: 4) {
                ForEach(AppState.lineWidths, id: \.self) { width in
                    Button {
                        state.selectLineWidth(width)
                    } label: {
                        Circle()
                            .fill(Color.white)
                            .frame(width: width, height: width)
                            .frame(width: 22, height: 28)
                            .background(
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(state.lineWidth == width ? Color.white.opacity(0.18) : Color.clear)
                            )
                    }
                    .buttonStyle(.plain)
                    .help("Stroke \(Int(width))")
                }
            }

            separator

            toolbarButton(symbol: "arrow.uturn.backward", help: "Undo (Cmd+Shift+Z)", action: state.undo)
            toolbarButton(symbol: "arrow.uturn.forward", help: "Redo (Cmd+Shift+Y)", action: state.redo)
            toolbarButton(symbol: "trash", help: "Clear (Cmd+Shift+C)", action: state.clear)

            separator

            toolbarButton(symbol: "arrow.counterclockwise", help: "Reset Toolbar Position", action: resetToolbar)
            toolbarButton(symbol: "power", help: "Quit", action: quit)
        }
        .padding(.horizontal, 8)
        .frame(width: ToolbarMetrics.width, height: ToolbarMetrics.height, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: ToolbarMetrics.cornerRadius)
                .fill(Color.black.opacity(0.86))
        )
        .overlay(
            RoundedRectangle(cornerRadius: ToolbarMetrics.cornerRadius)
                .stroke(Color.white.opacity(0.10), lineWidth: 1)
        )
    }

    private var dragHandle: some View {
        DragHandleRepresentable()
            .frame(width: 20, height: 34)
            .modifier(CursorOnHoverModifier(cursor: .openHand))
            .help("Drag Toolbar")
    }

    private var shapeMenu: some View {
        Button {
            isShowingShapePicker.toggle()
        } label: {
            HStack(spacing: 3) {
                Image(systemName: currentShapeTool.symbolName)
                    .font(.system(size: 15, weight: .semibold))
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .bold))
                    .opacity(0.7)
            }
            .frame(width: 38, height: 30)
        }
        .buttonStyle(ToolbarMenuButtonStyle(active: state.drawingEnabled && shapeTools.contains(state.currentTool)))
        .disabled(!state.overlayVisible)
        .opacity(state.overlayVisible ? 1 : 0.34)
        .help("Shape Tools")
        .popover(isPresented: $isShowingShapePicker, arrowEdge: .bottom) {
            ShapePickerPanel(
                tools: shapeTools,
                selectedTool: currentShapeTool
            ) { tool in
                state.selectTool(tool)
                isShowingShapePicker = false
            }
        }
    }

    private var colorMenu: some View {
        Button {
            isShowingColorPicker.toggle()
        } label: {
            HStack(spacing: 4) {
                Circle()
                    .fill(state.selectedColor.swiftUIColor)
                    .frame(width: 18, height: 18)
                    .overlay(Circle().stroke(Color.white.opacity(0.84), lineWidth: 1.5))
                    .overlay(Circle().stroke(Color.black.opacity(0.24), lineWidth: 1))
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.7))
            }
            .frame(width: 38, height: 30)
        }
        .buttonStyle(ToolbarMenuButtonStyle(active: false))
        .help("Colors")
        .popover(isPresented: $isShowingColorPicker, arrowEdge: .bottom) {
            ColorPickerPanel(
                inks: AppState.presetColors,
                selectedColor: state.selectedColor
            ) { color in
                state.selectColor(color)
                isShowingColorPicker = false
            }
        }
    }

    private var separator: some View {
        Rectangle()
            .fill(Color.white.opacity(0.16))
            .frame(width: 1, height: 28)
    }

    private func toolbarButton(
        symbol: String,
        active: Bool = false,
        enabled: Bool = true,
        help: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 30, height: 30)
        }
        .buttonStyle(ToolbarIconButtonStyle(active: active))
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.34)
        .help(help)
    }
}

private struct ShapePickerPanel: View {
    let tools: [DrawingTool]
    let selectedTool: DrawingTool
    let select: (DrawingTool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(tools) { tool in
                Button {
                    select(tool)
                } label: {
                    PickerRow(
                        symbol: tool.symbolName,
                        title: tool.helpTitle,
                        isSelected: tool == selectedTool
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .frame(width: 156)
        .background(PopoverBackground())
    }
}

private struct ColorPickerPanel: View {
    let inks: [PresetInk]
    let selectedColor: RGBAColor
    let select: (RGBAColor) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(inks) { ink in
                Button {
                    select(ink.color)
                } label: {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(ink.color.swiftUIColor)
                            .frame(width: 15, height: 15)
                            .overlay(Circle().stroke(Color.white.opacity(0.68), lineWidth: 1))
                            .overlay(Circle().stroke(Color.black.opacity(0.24), lineWidth: 1))

                        Text(ink.name)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.90))

                        Spacer(minLength: 8)

                        if ink.color == selectedColor {
                            Image(systemName: "checkmark")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(Color.white)
                        }
                    }
                    .frame(height: 28)
                    .padding(.horizontal, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .frame(width: 150)
        .background(PopoverBackground())
    }
}

private struct PickerRow: View {
    let symbol: String
    let title: String
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.90))
                .frame(width: 18)

            Text(title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.90))

            Spacer(minLength: 8)

            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.white)
            }
        }
        .frame(height: 28)
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
    }
}

private struct PopoverBackground: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color(red: 0.10, green: 0.11, blue: 0.13).opacity(0.98))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.white.opacity(0.16), lineWidth: 1)
            )
    }
}

private struct CursorOnHoverModifier: ViewModifier {
    let cursor: NSCursor
    @State private var isCursorPushed = false

    func body(content: Content) -> some View {
        content
            .onHover { isHovering in
                if isHovering {
                    pushCursor()
                } else {
                    popCursor()
                }
            }
            .onDisappear {
                popCursor()
            }
    }

    private func pushCursor() {
        guard !isCursorPushed else {
            cursor.set()
            return
        }

        cursor.push()
        isCursorPushed = true
    }

    private func popCursor() {
        guard isCursorPushed else { return }
        NSCursor.pop()
        isCursorPushed = false
    }
}

private struct ToolbarIconButtonStyle: ButtonStyle {
    var active: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.white)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(backgroundColor(isPressed: configuration.isPressed))
            )
    }

    private func backgroundColor(isPressed: Bool) -> Color {
        if active {
            return Color(red: 0.12, green: 0.42, blue: 0.95)
        }
        if isPressed {
            return Color.white.opacity(0.22)
        }
        return Color.white.opacity(0.001)
    }
}

private struct ToolbarMenuButtonStyle: ButtonStyle {
    var active: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.white)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(backgroundColor(isPressed: configuration.isPressed))
            )
    }

    private func backgroundColor(isPressed: Bool) -> Color {
        if active {
            return Color(red: 0.12, green: 0.42, blue: 0.95)
        }
        if isPressed {
            return Color.white.opacity(0.22)
        }
        return Color.white.opacity(0.001)
    }
}

private struct DragHandleRepresentable: NSViewRepresentable {
    func makeNSView(context: Context) -> DragHandleView {
        DragHandleView(frame: .zero)
    }

    func updateNSView(_ nsView: DragHandleView, context: Context) {
        nsView.needsDisplay = true
    }
}

private final class DragHandleView: NSView {
    private var handleTrackingArea: NSTrackingArea?
    private var dragStartMouseLocation: CGPoint?
    private var dragStartWindowOrigin: CGPoint?
    private var isHovering = false {
        didSet {
            if isHovering != oldValue {
                needsDisplay = true
            }
        }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    override var acceptsFirstResponder: Bool { true }
    override var isOpaque: Bool { false }
    override var mouseDownCanMoveWindow: Bool { false }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.acceptsMouseMovedEvents = true
        if let window {
            window.invalidateCursorRects(for: self)
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()

        if let handleTrackingArea {
            removeTrackingArea(handleTrackingArea)
        }

        let area = NSTrackingArea(
            rect: bounds,
            options: [.activeAlways, .inVisibleRect, .mouseEnteredAndExited, .mouseMoved, .cursorUpdate],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        handleTrackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        isHovering = true
        NSCursor.openHand.set()
    }

    override func mouseMoved(with event: NSEvent) {
        NSCursor.openHand.set()
    }

    override func mouseExited(with event: NSEvent) {
        isHovering = false
    }

    override func cursorUpdate(with event: NSEvent) {
        NSCursor.openHand.set()
    }

    override func mouseDown(with event: NSEvent) {
        isHovering = true
        dragStartMouseLocation = NSEvent.mouseLocation
        dragStartWindowOrigin = window?.frame.origin
        NSCursor.closedHand.set()
    }

    override func mouseDragged(with event: NSEvent) {
        guard
            let window,
            let dragStartMouseLocation,
            let dragStartWindowOrigin
        else {
            return
        }

        let currentMouseLocation = NSEvent.mouseLocation
        let delta = CGPoint(
            x: currentMouseLocation.x - dragStartMouseLocation.x,
            y: currentMouseLocation.y - dragStartMouseLocation.y
        )

        window.setFrameOrigin(
            CGPoint(
                x: dragStartWindowOrigin.x + delta.x,
                y: dragStartWindowOrigin.y + delta.y
            )
        )
        NSCursor.closedHand.set()
    }

    override func mouseUp(with event: NSEvent) {
        dragStartMouseLocation = nil
        dragStartWindowOrigin = nil
        NSCursor.openHand.set()
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .openHand)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        NSColor.clear.setFill()
        dirtyRect.fill()

        if isHovering {
            NSColor.white.withAlphaComponent(0.10).setFill()
            NSBezierPath(roundedRect: bounds, xRadius: 5, yRadius: 5).fill()
        }

        NSColor.white.withAlphaComponent(isHovering ? 0.72 : 0.48).setFill()

        let dotSize: CGFloat = 4
        let gap: CGFloat = 4
        let totalWidth = dotSize * 2 + gap
        let totalHeight = dotSize * 3 + gap * 2
        let originX = bounds.midX - totalWidth / 2
        let originY = bounds.midY - totalHeight / 2

        for row in 0..<3 {
            for column in 0..<2 {
                let rect = CGRect(
                    x: originX + CGFloat(column) * (dotSize + gap),
                    y: originY + CGFloat(row) * (dotSize + gap),
                    width: dotSize,
                    height: dotSize
                )
                NSBezierPath(ovalIn: rect).fill()
            }
        }
    }
}
