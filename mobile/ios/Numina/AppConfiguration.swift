import Foundation

enum AppConfiguration {
    static let runtimeVersion = Bundle.main.object(forInfoDictionaryKey: "NuminaRuntimeVersion") as? String ?? "Not available"
    static let coreVersion = Bundle.main.object(forInfoDictionaryKey: "NuminaCoreVersion") as? String ?? "Not available"
    static let origin = URL(string: "https://numinalabs.xyz")!
    static let startURL = origin.appendingPathComponent("app")
    static let frontierURL = origin.appendingPathComponent("frontier")
    static let privacyURL = origin.appendingPathComponent("privacy")
    static let supportURL = origin.appendingPathComponent("contact")
    static let runtimeMetricsURL: URL = {
        var components = URLComponents(url: frontierURL, resolvingAgainstBaseURL: false)!
        components.fragment = "runtime-metrics"
        return components.url!
    }()

    static func isFirstParty(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https"
            && url.host?.lowercased() == origin.host?.lowercased()
            && (url.port == nil || url.port == 443)
            && url.user == nil && url.password == nil
    }

    static func diagnosticRoute(_ url: URL) -> String {
        guard isFirstParty(url) else { return "External navigation" }
        // Never retain query strings, fragments, or arbitrary private resource paths.
        let publicRoutes = ["/", "/app", "/frontier", "/privacy", "/contact", "/control"]
        return publicRoutes.contains(url.path) ? url.path : "Other first-party page"
    }

    static func isBrowserSignIn(_ url: URL) -> Bool {
        isFirstParty(url) && (url.path == "/signin-with-chatgpt"
            || url.path.hasPrefix("/signin-with-chatgpt/"))
    }

    static func canOpenExternally(_ url: URL) -> Bool {
        guard url.user == nil, url.password == nil else { return false }
        switch url.scheme?.lowercased() {
        case "https": return url.host != nil
        case "mailto", "tel": return true
        default: return false
        }
    }
}
