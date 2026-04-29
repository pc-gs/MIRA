import SwiftUI

struct DrawingSurfaceRepresentable: NSViewRepresentable {
    @ObservedObject var state: AppState
    let screenID: String

    func makeNSView(context: Context) -> DrawingSurfaceView {
        DrawingSurfaceView(state: state, screenID: screenID)
    }

    func updateNSView(_ nsView: DrawingSurfaceView, context: Context) {
        nsView.refresh(state: state, screenID: screenID)
    }
}
