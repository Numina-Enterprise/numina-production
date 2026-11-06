import SwiftUI
import UIKit

@MainActor
struct ContentView: View {
    @StateObject private var model = HostedAppModel()
    @State private var showingSystemStatus = false

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
            .safeAreaInset(edge: .bottom, spacing: 0) {
                HStack(spacing: 0) {
                    nativeAction("Workspace", icon: "house", isSelected: model.pageObservation.route == "/app", action: model.home)
                    nativeAction("Services", icon: "square.grid.2x2", isSelected: model.pageObservation.route == "/services", action: model.services)
                    nativeAction("Frontier", icon: "globe", isSelected: model.pageObservation.route == "/frontier", action: model.frontier)
                    nativeAction("Status", icon: "info.circle") { showingSystemStatus = true }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(.regularMaterial)
                .overlay(alignment: .top) { Divider() }
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
                        Button("Services", action: model.services)
                        Button("Frontier", action: model.frontier)
                        Button("Runtime & Quantum", action: model.openRuntimeMetrics)
                        Button("Reload", action: model.retry)
                        Button("Open in Browser", action: model.openBrowserWorkspace)
                        Button("System Status") { showingSystemStatus = true }
                        Button("Privacy") { model.load(AppConfiguration.privacyURL) }
                        Button("Support") { model.load(AppConfiguration.supportURL) }
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                }
            }
            .onAppear(perform: model.start)
            .sheet(isPresented: $showingSystemStatus) {
                NativeSystemStatusView(model: model)
            }
            .alert(item: $model.externalLink) { link in
                Alert(title: Text(link.title), message: Text(link.message),
                      primaryButton: .default(Text("Continue")) { model.openExternal(link.url) },
                      secondaryButton: .cancel())
            }
        }
        .navigationViewStyle(.stack)
    }

    private func nativeAction(_ title: String, icon: String, isSelected: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.title3)
                Text(title).font(.caption)
            }
            .frame(maxWidth: .infinity, minHeight: 50)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundColor(isSelected ? .accentColor : .primary)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityLabel(title == "Status" ? "Show System Status" : "Open \(title)")
    }
}


// Displays the existing web view's observations. It issues no independent probes.
@MainActor
private struct NativeSystemStatusView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: HostedAppModel

    var body: some View {
        NavigationView {
            List {
                Section("App") {
                    detail("Version", Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown")
                    detail("Build", Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown")
                    detail("Runtime dependency", AppConfiguration.runtimeVersion)
                    detail("Core dependency", AppConfiguration.coreVersion)
                    detail("iOS", UIDevice.current.systemVersion)
                    detail("Device", UIDevice.current.model)
                }
                Section {
                    detail("Page state", model.pageObservation.phase)
                    detail("Route", model.pageObservation.route)
                    detail("HTTP response", model.pageObservation.httpStatus.map { String($0) } ?? "Not observed")
                    if let time = model.pageObservation.responseAt {
                        detail("Response observed", time.formatted(date: .abbreviated, time: .standard))
                    }
                    if let time = model.pageObservation.completedAt {
                        detail("Navigation finished", time.formatted(date: .abbreviated, time: .standard))
                    }
                    if let category = model.pageObservation.failureCategory {
                        detail("Failure category", category)
                    }
                } header: {
                    Text("This web view")
                } footer: {
                    Text("Observed from the existing page navigation, not a separate health probe. A loaded page does not establish API success, authenticated access, or quantum hardware execution.")
                }
                Section {
                    Button("Open Runtime & Quantum") {
                        dismiss()
                        model.openRuntimeMetrics()
                    }
                    Button("Continue Runtime & Quantum in Browser") {
                        dismiss()
                        model.openBrowserRuntimeMetrics()
                    }
                } header: {
                    Text("Canonical owner metrics")
                } footer: {
                    Text("Opens Frontier's shared runtime panel. HTTP metrics, simulator workload and IBM configuration use the existing owner-only endpoint. Browser sign-in stays in the browser; no credentials are copied into this app.")
                }
            }
            .navigationTitle("System Status")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .navigationViewStyle(.stack)
    }

    private func detail(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
            Spacer(minLength: 12)
            Text(value).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}
