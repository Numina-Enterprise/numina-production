import Foundation

enum AppConfiguration {
    static let startURL = URL(string: "https://numinalabs.xyz/app")!
    static let privacyURL = URL(string: "https://numinalabs.xyz/privacy")!
    static let supportURL = URL(string: "https://numinalabs.xyz/contact")!

    static func isFirstParty(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https"
            && url.host?.lowercased() == "numinalabs.xyz"
            && (url.port == nil || url.port == 443)
            && url.user == nil && url.password == nil
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
