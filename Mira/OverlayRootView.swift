import AppKit
import SwiftUI

struct OverlayRootView: View {
    @ObservedObject var state: AppState
    let screen: ScreenDescriptor

    @State private var cursor = CGPoint.zero
    private let cursorTimer = Timer.publish(every: 1.0 / 60.0, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack(alignment: .topLeading) {
            DrawingSurfaceRepresentable(state: state, screenID: screen.id)

            if state.spotlightEnabled {
                Circle()
                    .stroke(Color.white.opacity(0.88), lineWidth: 3)
                    .frame(width: 80, height: 80)
                    .shadow(color: Color.black.opacity(0.45), radius: 1, x: 0, y: 0)
                    .shadow(color: Color.white.opacity(0.34), radius: 10, x: 0, y: 0)
                    .position(cursor)
                    .allowsHitTesting(false)
            }
        }
        .background(Color.clear)
        .onReceive(cursorTimer) { _ in
            cursor = localMouseLocation()
        }
    }

    private func localMouseLocation() -> CGPoint {
        let global = NSEvent.mouseLocation
        return CGPoint(
            x: global.x - screen.frame.minX,
            y: screen.frame.maxY - global.y
        )
    }
}
