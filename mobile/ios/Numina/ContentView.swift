import SwiftUI

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
                NativeSystemStatusView()
            }
            .alert(item: $model.externalLink) { link in
                Alert(title: Text(link.title), message: Text(link.message),
                      primaryButton: .default(Text("Continue")) { model.openExternal(link.url) },
                      secondaryButton: .cancel())
            }
        }
        .navigationViewStyle(.stack)
    }
}


private struct NativeStatusCheck: Identifiable {
    let id = UUID()
    let name: String
    let url: URL
    var responseCode: Int? = nil
    var succeeded = false
}

@MainActor
private final class NativeSystemStatusModel: ObservableObject {
    @Published var checks: [NativeStatusCheck] = [
        .init(name: "Workspace", url: AppConfiguration.startURL),
        .init(name: "Privacy", url: AppConfiguration.privacyURL),
        .init(name: "Support", url: AppConfiguration.supportURL),
        .init(name: "NUSD status API", url: URL(string: "https://numinalabs.xyz/api/nusd/v1/status")!),
        .init(name: "Node status API", url: URL(string: "https://numinalabs.xyz/v2/network/status")!)
    ]
    @Published var isChecking = false
    @Published var checkedAt: Date?

    func refresh() {
        guard !isChecking else { return }
        isChecking = true
        Task {
            var next = checks
            await withTaskGroup(of: (Int, Int?, Bool).self) { group in
                for (index, check) in next.enumerated() {
                    group.addTask {
                        var request = URLRequest(url: check.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
                        request.httpMethod = "GET"
                        do {
                            let (_, response) = try await URLSession.shared.data(for: request)
                            let code = (response as? HTTPURLResponse)?.statusCode
                            return (index, code, code.map { (200..<400).contains($0) } ?? false)
                        } catch {
                            return (index, nil, false)
                        }
                    }
                }
                for await (index, code, succeeded) in group {
                    next[index].responseCode = code
                    next[index].succeeded = succeeded
                }
            }
            checks = next
            checkedAt = Date()
            isChecking = false
        }
    }
}

private struct NativeSystemStatusView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = NativeSystemStatusModel()

    var body: some View {
        NavigationView {
            List {
                Section("App") {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown")
                    LabeledContent("Build", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown")
                    LabeledContent("iOS", value: UIDevice.current.systemVersion)
                    LabeledContent("Device", value: UIDevice.current.model)
                }

                Section {
                    ForEach(model.checks) { check in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(check.name).font(.body.weight(.medium))
                                Text(check.url.path.isEmpty ? "/" : check.url.path)
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if model.isChecking && check.responseCode == nil {
                                ProgressView()
                            } else {
                                Image(systemName: check.succeeded ? "checkmark.circle.fill" : "exclamationmark.circle")
                                    .accessibilityLabel(check.succeeded ? "Available" : "Unavailable")
                            }
                        }
                    }
                } header: {
                    Text("First-party availability")
                } footer: {
                    Text("These checks report whether Numina first-party HTTPS endpoints respond. They do not verify asset backing, signing, settlement, custody, or external-provider state.")
                }

                if let checkedAt = model.checkedAt {
                    Section("Last checked") {
                        Text(checkedAt.formatted(date: .abbreviated, time: .standard))
                    }
                }
            }
            .navigationTitle("System Status")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Refresh", action: model.refresh).disabled(model.isChecking)
                }
            }
            .onAppear(perform: model.refresh)
        }
        .navigationViewStyle(.stack)
    }
}
