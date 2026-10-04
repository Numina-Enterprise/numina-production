import Combine
import Foundation
import UIKit
import WebKit

struct ExternalLink: Identifiable {
    let id = UUID()
    let url: URL
    let isSignIn: Bool

    var title: String { isSignIn ? "Continue sign-in in your browser" : "Open external link" }
    var message: String {
        if isSignIn {
            return "Sign-in and signed-in work continue in your browser. Your browser and this app use separate sessions."
        }
        if let host = url.host {
            return "Open \(host) in your browser?"
        }
        return "Open this link in another app?"
    }
}

struct HostedPageObservation {
    var phase = "Not loaded"
    var route = "Not observed"
    var httpStatus: Int?
    var responseAt: Date?
    var completedAt: Date?
    var failureCategory: String?
}

@MainActor
final class HostedAppModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    @Published var isLoading = false
    @Published var canGoBack = false
    @Published var failure: String?
    @Published var externalLink: ExternalLink?
    @Published private(set) var pageObservation = HostedPageObservation()
    private var observedNavigation: WKNavigation?
    private var hasStarted = false
    private var lastPageURL = AppConfiguration.startURL
    private var retryPageURL = AppConfiguration.startURL
    private var canRetryCurrentNavigation = false

    override init() {
        let configuration = WKWebViewConfiguration()
        // WebKit owns cookies and cache. Never copy credentials between browser and app.
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
    }

    func start() {
        guard !hasStarted else { return }
        hasStarted = true
        load(AppConfiguration.startURL)
    }

    func load(_ url: URL) {
        guard AppConfiguration.isFirstParty(url), !AppConfiguration.isBrowserSignIn(url) else { return }
        failure = nil
        // Remember this attempted page even when navigation fails before didFinish.
        retryPageURL = url
        // Retry builds a fresh GET and never reuses a submission's method or body.
        var request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30)
        request.httpMethod = "GET"
        webView.load(request)
    }

    func retry() { load(retryPageURL) }
    func home() { load(AppConfiguration.startURL) }
    func frontier() { load(AppConfiguration.frontierURL) }
    func openRuntimeMetrics() { load(AppConfiguration.runtimeMetricsURL) }
    func openBrowserRuntimeMetrics() { openExternal(AppConfiguration.runtimeMetricsURL) }
    func back() { if webView.canGoBack { failure = nil; webView.goBack() } }

    func openBrowserWorkspace() {
        openExternal(AppConfiguration.browserWorkspaceURL)
    }

    func openExternal(_ url: URL) {
        guard AppConfiguration.canOpenExternally(url) else { return }
        UIApplication.shared.open(url, options: [:]) { [weak self] opened in
            guard !opened else { return }
            Task { @MainActor [weak self] in
                self?.failure = "This link could not be opened. Please try again or open numinalabs.xyz/app in your browser."
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        // Allow HTTPS embedded frames for the existing hosted content. They receive no
        // native message handlers. They may not launch external applications themselves.
        if let frame = navigationAction.targetFrame, !frame.isMainFrame {
            decisionHandler(url.scheme?.lowercased() == "https" ? .allow : .cancel)
            return
        }

        if AppConfiguration.isBrowserSignIn(url) {
            // Intercept before a web-view OAuth cookie/state is created. Starting the
            // first-party sign-in URL in the browser keeps that entire flow together.
            externalLink = ExternalLink(url: url, isSignIn: true)
            observedNavigation = nil
            pageObservation = HostedPageObservation(phase: "Browser sign-in required")
            isLoading = false
            decisionHandler(.cancel)
            return
        }
        if AppConfiguration.isFirstParty(url) {
            // Track only body-free page GETs for retry, not form submissions.
            let request = navigationAction.request
            let method = request.httpMethod?.uppercased() ?? "GET"
            canRetryCurrentNavigation = method == "GET"
                && request.httpBody == nil && request.httpBodyStream == nil
                && navigationAction.navigationType != .formSubmitted
                && navigationAction.navigationType != .formResubmitted
            retryPageURL = canRetryCurrentNavigation ? url : lastPageURL
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        isLoading = false
        guard navigationAction.request.httpMethod == nil || navigationAction.request.httpMethod == "GET" else {
            failure = "Continue in your browser to use this form. The app has not forwarded its contents."
            return
        }
        if AppConfiguration.canOpenExternally(url) {
            externalLink = ExternalLink(url: url, isSignIn: false)
        } else {
            failure = "This type of link is unavailable in the app. Return to the workspace or continue in your browser."
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // Open first-party target=_blank links in this view without a second web view.
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url else { return nil }
        if AppConfiguration.isBrowserSignIn(url) {
            externalLink = ExternalLink(url: url, isSignIn: true)
        } else if AppConfiguration.isFirstParty(url) {
            webView.load(navigationAction.request)
        } else if AppConfiguration.canOpenExternally(url) {
            externalLink = ExternalLink(url: url, isSignIn: false)
        }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard navigationResponse.isForMainFrame else {
            decisionHandler(.allow)
            return
        }
        guard let url = navigationResponse.response.url, AppConfiguration.isFirstParty(url) else {
            decisionHandler(.cancel)
            isLoading = false
            pageObservation = HostedPageObservation(phase: "Blocked response", failureCategory: "untrusted_destination")
            failure = "This page cannot be displayed in the app. You can continue in your browser."
            return
        }
        pageObservation.route = AppConfiguration.diagnosticRoute(url)
        if let response = navigationResponse.response as? HTTPURLResponse {
            pageObservation.httpStatus = response.statusCode
            pageObservation.responseAt = Date()
            pageObservation.phase = "Response received"
            if response.statusCode >= 400 {
                decisionHandler(.cancel)
                isLoading = false
                pageObservation.phase = "HTTP error"
                pageObservation.failureCategory = "http_error"
                failure = "Numina could not load this page. Try again shortly."
                return
            }
        }
        guard navigationResponse.canShowMIMEType else {
            decisionHandler(.cancel)
            isLoading = false
            pageObservation.phase = "Browser continuation required"
            pageObservation.failureCategory = "unsupported_content"
            failure = "Open the workspace in your browser to download this file."
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        observedNavigation = navigation
        pageObservation = HostedPageObservation(phase: "Loading")
        isLoading = true
        failure = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let navigation = navigation, navigation === observedNavigation else { return }
        pageObservation.phase = "Page navigation finished"
        pageObservation.completedAt = Date()
        isLoading = false
        canGoBack = webView.canGoBack
        if canRetryCurrentNavigation, let url = webView.url,
           AppConfiguration.isFirstParty(url), !AppConfiguration.isBrowserSignIn(url) {
            lastPageURL = url
            retryPageURL = url
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard let navigation = navigation, navigation === observedNavigation else { return }
        showLoadFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard let navigation = navigation, navigation === observedNavigation else { return }
        showLoadFailure(error)
    }

    private func showLoadFailure(_ error: Error) {
        let nsError = error as NSError
        // Policy cancellation and superseded loads are expected; do not replace the page.
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        isLoading = false
        canGoBack = webView.canGoBack
        pageObservation.phase = "Navigation failed"
        pageObservation.completedAt = nil
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorTimedOut {
            pageObservation.failureCategory = "timeout"
        } else if nsError.domain == NSURLErrorDomain &&
                    [NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost].contains(nsError.code) {
            pageObservation.failureCategory = "connectivity"
        } else {
            pageObservation.failureCategory = "navigation_error"
        }
        failure = "Numina could not connect. Check your connection and try again. Sign-in and current records need an internet connection."
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        isLoading = false
        observedNavigation = nil
        pageObservation.phase = "Web content process terminated"
        pageObservation.failureCategory = "web_content_process"
        pageObservation.completedAt = nil
        failure = "The page stopped responding. Reload to continue."
    }

    // No trust-challenge override: the system performs normal certificate validation.
    // This candidate does not need access to a camera or microphone.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }
}
