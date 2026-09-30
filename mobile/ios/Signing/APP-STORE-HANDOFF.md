# Numina App Store Connect handoff

Status: preparation only; no app record, upload, review approval, or commercial commitment is created by this file.

| Item | Current evidence / required action |
| --- | --- |
| Organization | SK Consulting LLC; user reported Developer registration complete. Verify actual Apple membership and seller identity. |
| Bundle | Proposed `xyz.numinalabs.app`; confirm against the actual Apple app record. |
| Release | Source 4.0.0 build 6. Check Apple build history before upload; do not reuse an uploaded build number. |
| Runtime | Dependency 1.9.0-rc26, core 1.8.0; not an Apple review status. |
| Archive | Fresh macOS archive and validation are outstanding. Historical unsigned build 5 is not current source. |
| Authentication | Hosted sign-in continues in the browser; returning a signed-in session to WKWebView is not implemented. Explain the real behavior to reviewers. |
| Privacy | Audit native and hosted data flows, including providers. Complete accurate privacy disclosures; do not infer no collection from no native analytics SDK. |
| Account deletion | Review and implement the applicable in-app deletion flow where account creation is offered. |
| Functionality | Native navigation and diagnostics exist in source; review minimum-functionality eligibility and exercise them on device. |
| Payments | Review actual digital-goods/services and geographic flows. Do not claim financial permissions from a signing certificate. |
| Store assets | Real screenshots, support/privacy URLs, age rating, rights and review access remain to be verified. |
| TestFlight / review | Record only actual Apple processing, testing and review results. |

Relevant Apple guidance: https://developer.apple.com/app-store/review/guidelines/ and https://developer.apple.com/app-store/app-privacy-details/
