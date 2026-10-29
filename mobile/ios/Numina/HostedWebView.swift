import SwiftUI
import WebKit

@MainActor
struct HostedWebView: UIViewRepresentable {
    @ObservedObject var model: HostedAppModel

    func makeUIView(context: Context) -> WKWebView { model.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
