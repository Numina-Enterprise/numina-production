import SwiftUI

@MainActor
struct ContentView: View {
    @StateObject private var model = HostedAppModel()

    var body: some View {
        NavigationView {
            ZStack {
                HostedWebView(model: model)
                if let failure = model.failure {
                    VStack(spacing: 18) {
                        Image(systemName: "wifi.exclamationmark").font(.largeTitle).accessibilityHidden(true)
                        Text("Unable to load Numina").font(.title2).bold()
                        Text(failure).multilineTextAlignment(.center)
                        Button("Try Again", action: model.retry).buttonStyle(.borderedProminent)
                        Button("Open in Browser", action: model.openBrowserWorkspace)
                    }
                    .padding(28)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.systemBackground))
                }
            }
            .overlay(alignment: .top) {
                if model.isLoading && model.failure == nil {
                    ProgressView("Loading Numina…")
                        .padding(12)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.top, 8)
                }
            }
            .navigationTitle("Numina")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: model.back) {
                        Label("Back", systemImage: "chevron.left")
                    }
                    .disabled(!model.canGoBack)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button("Workspace", action: model.home)
                        Button("Reload", action: model.retry)
                        Button("Open in Browser", action: model.openBrowserWorkspace)
                        Button("Privacy") { model.load(AppConfiguration.privacyURL) }
                        Button("Support") { model.load(AppConfiguration.supportURL) }
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                }
            }
            .onAppear(perform: model.start)
            .alert(item: $model.externalLink) { link in
                Alert(title: Text(link.title), message: Text(link.message),
                      primaryButton: .default(Text("Continue")) { model.openExternal(link.url) },
                      secondaryButton: .cancel())
            }
        }
        .navigationViewStyle(.stack)
    }
}
