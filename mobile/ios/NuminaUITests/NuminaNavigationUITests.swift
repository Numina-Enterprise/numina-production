import XCTest

final class NuminaNavigationUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testNavigationControlsAndSystemStatus() throws {
        let app = XCUIApplication()
        app.launch()

        let workspace = app.buttons["Open Workspace"]
        XCTAssertTrue(workspace.waitForExistence(timeout: 20), "Native workspace button should appear")
        XCTAssertTrue(app.buttons["Open Services"].exists)
        XCTAssertTrue(app.buttons["Open Frontier"].exists)

        let status = app.buttons["Show System Status"]
        XCTAssertTrue(status.exists)
        status.tap()

        let done = app.buttons["Done"]
        XCTAssertTrue(done.waitForExistence(timeout: 10), "Status sheet should open")
        XCTAssertTrue(app.staticTexts["System Status"].exists)
        done.tap()

        XCTAssertTrue(workspace.waitForExistence(timeout: 10), "Dismissal should return to the workspace")
    }

    func testFirstPartyTabsCanBeSelected() throws {
        let app = XCUIApplication()
        app.launch()

        let workspace = app.buttons["Open Workspace"]
        let services = app.buttons["Open Services"]
        let frontier = app.buttons["Open Frontier"]
        XCTAssertTrue(workspace.waitForExistence(timeout: 20))

        services.tap()
        XCTAssertTrue(waitForSelection(services), "Services should be selected once the hosted page responds")

        frontier.tap()
        XCTAssertTrue(waitForSelection(frontier), "Frontier should be selected once the hosted page responds")

        workspace.tap()
        XCTAssertTrue(waitForSelection(workspace), "Workspace should be selected once the hosted page responds")
    }

    private func waitForSelection(_ element: XCUIElement) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "selected == YES"), object: element
        )
        return XCTWaiter.wait(for: [expectation], timeout: 25) == .completed
    }
}
