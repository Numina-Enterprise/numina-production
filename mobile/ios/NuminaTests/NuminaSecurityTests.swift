import XCTest
@testable import Numina

final class NuminaSecurityTests: XCTestCase {
    func testFirstPartyRequiresExactHTTPSHostAndDefaultPort() {
        XCTAssertTrue(AppConfiguration.isFirstParty(URL(string: "https://numinalabs.xyz/app")!))
        XCTAssertTrue(AppConfiguration.isFirstParty(URL(string: "https://numinalabs.xyz:443/services")!))

        for address in [
            "http://numinalabs.xyz/app",
            "https://numinalabs.xyz.evil.example/app",
            "https://evilnuminalabs.xyz/app",
            "https://numinalabs.xyz:444/app",
            "https://user:password@numinalabs.xyz/app",
            "https://example.org/app"
        ] {
            XCTAssertFalse(AppConfiguration.isFirstParty(URL(string: address)!), address)
        }
    }

    func testBrowserSignInIsOnlyFirstPartyAuthenticationPath() {
        XCTAssertTrue(AppConfiguration.isBrowserSignIn(URL(string: "https://numinalabs.xyz/signin-with-chatgpt?return_to=%2Fapp")!))
        XCTAssertTrue(AppConfiguration.isBrowserSignIn(URL(string: "https://numinalabs.xyz/signin-with-chatgpt/continue")!))
        XCTAssertFalse(AppConfiguration.isBrowserSignIn(URL(string: "https://numinalabs.xyz/signin-with-chatgpt-fake")!))
        XCTAssertFalse(AppConfiguration.isBrowserSignIn(URL(string: "https://external.example/signin-with-chatgpt")!))
    }

    func testDiagnosticRouteSuppressesPrivateData() {
        XCTAssertEqual(AppConfiguration.diagnosticRoute(URL(string: "https://numinalabs.xyz/services?secret=value")!), "/services")
        XCTAssertEqual(AppConfiguration.diagnosticRoute(URL(string: "https://numinalabs.xyz/app#account")!), "/app")
        XCTAssertEqual(AppConfiguration.diagnosticRoute(URL(string: "https://numinalabs.xyz/api/app/v1/private?id=123")!), "Other first-party page")
        XCTAssertEqual(AppConfiguration.diagnosticRoute(URL(string: "https://example.org/app")!), "External navigation")
    }

    func testExternalSchemesAreAllowlisted() {
        XCTAssertTrue(AppConfiguration.canOpenExternally(URL(string: "https://example.org/")!))
        XCTAssertTrue(AppConfiguration.canOpenExternally(URL(string: "mailto:support@example.org")!))
        XCTAssertTrue(AppConfiguration.canOpenExternally(URL(string: "tel:+1234567890")!))
        XCTAssertFalse(AppConfiguration.canOpenExternally(URL(string: "http://example.org/")!))
        XCTAssertFalse(AppConfiguration.canOpenExternally(URL(string: "javascript:alert(1)")!))
        XCTAssertFalse(AppConfiguration.canOpenExternally(URL(string: "file:///tmp/test")!))
        XCTAssertFalse(AppConfiguration.canOpenExternally(URL(string: "https://name:password@example.org/")!))
    }
}
