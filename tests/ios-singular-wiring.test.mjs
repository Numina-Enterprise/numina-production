import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {telemetryHttp} from '../src/telemetry-http.js';
import {quantumHttp} from '../src/quantum-http.js';
import {controlHash, stable} from '../src/control.js';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const configuration = read('mobile/ios/Numina/AppConfiguration.swift');
const model = read('mobile/ios/Numina/HostedAppModel.swift');
const view = read('mobile/ios/Numina/ContentView.swift');
const swift = readdirSync(new URL('mobile/ios/Numina/', root))
  .filter(name => name.endsWith('.swift')).map(name => read('mobile/ios/Numina/' + name)).join('\n');

test('iOS routes to the existing Frontier panel and canonical metrics client', () => {
  assert.match(configuration, /static let origin = URL\(string: "https:\/\/numinalabs\.xyz"\)!/);
  assert.match(configuration, /frontierURL = origin\.appendingPathComponent\("frontier"\)/);
  assert.match(configuration, /components\.fragment = "runtime-metrics"/);
  assert.match(read('public/frontier.html'), /id="runtime-metrics"/);
  assert.match(read('public/frontier.html'), /src="\/telemetry-ui\.js"/);
  assert.match(read('public/telemetry-ui.js'), /requestJson\('\/api\/ops\/v1\/telemetry'/);
  assert.match(model, /func openRuntimeMetrics\(\) \{ load\(AppConfiguration\.runtimeMetricsURL\) \}/);
  assert.match(model, /func openBrowserRuntimeMetrics\(\) \{ openExternal\(AppConfiguration\.runtimeMetricsURL\) \}/);
});

test('native diagnostics reuse one model and do not create a second transport or credential bridge', () => {
  assert.equal((swift.match(/WKWebView\(frame:/g) || []).length, 1);
  assert.equal((swift.match(/@StateObject private var model = HostedAppModel\(\)/g) || []).length, 1);
  assert.match(view, /NativeSystemStatusView\(model: model\)/);
  assert.match(view, /@ObservedObject var model: HostedAppModel/);
  assert.doesNotMatch(swift, /URLSession|NativeStatusCheck|NativeSystemStatusModel|evaluateJavaScript|WKScriptMessageHandler|HTTPCookieStorage/);
  assert.match(model, /configuration\.websiteDataStore = \.default\(\)/);
});

test('navigation diagnostics are observed, correlated and do not store private URLs', () => {
  assert.match(model, /guard navigationResponse\.isForMainFrame/);
  assert.match(model, /pageObservation\.httpStatus = response\.statusCode/);
  assert.match(model, /pageObservation\.responseAt = Date\(\)/);
  assert.match(model, /navigation === observedNavigation/);
  assert.match(model, /pageObservation\.route = AppConfiguration\.diagnosticRoute\(url\)/);
  assert.match(configuration, /publicRoutes\.contains\(url\.path\) \? url\.path : "Other first-party page"/);
  assert.match(view, /A loaded page does not establish API success/);
});

test('iOS 15 compatibility and GET-only retry remain intact', () => {
  assert.match(read('mobile/ios/Configuration/Numina.xcconfig'), /IPHONEOS_DEPLOYMENT_TARGET = 15\.0/);
  assert.doesNotMatch(swift, /LabeledContent|NavigationStack/);
  assert.match(model, /request\.httpMethod = "GET"/);
  assert.match(model, /request\.httpBody == nil && request\.httpBodyStream == nil/);
  assert.match(model, /navigationAction\.navigationType != \.formResubmitted/);
});

async function environment() {
  return {NUMINA_CONTROL_OWNER:'owner', NUMINA_CONTROL_API_KEY_SHA256:await controlHash('singular-wiring-test-only'),
    NUMINA_TELEMETRY_LOGS:'false', get DB() { throw Error('No treasury storage is permitted in this test'); }};
}
const headers = {Authorization:'Bearer singular-wiring-test-only'};
const metricsRequest = () => new Request('https://n.test/api/ops/v1/telemetry', {headers});

test('canonical runtime snapshot still requires owner access and rejects writes', async () => {
  const env = await environment();
  assert.equal((await telemetryHttp(new Request('https://n.test/api/ops/v1/telemetry'), env)).status, 401);
  assert.equal((await telemetryHttp(new Request('https://n.test/api/ops/v1/telemetry', {method:'POST', headers}), env)).status, 405);
  const response = await telemetryHttp(metricsRequest(), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  const snapshot = await response.json();
  assert.equal(snapshot.schema, 'numina.telemetry.v1');
  assert.equal(snapshot.scope, 'current_process_only');
  assert.equal(snapshot.quantum.kind, 'classical_simulator');
  assert.equal(snapshot.quantum.ibm.jobSubmissionEnabled, false);
});

test('one local simulator job is visible through the existing unified telemetry endpoint', async () => {
  const env = await environment();
  const before = (await (await telemetryHttp(metricsRequest(), env)).json()).quantum.workload;
  const job = {id:'singular-wiring-local-test', Principal:'owner', Authority:'NUMINA', Objective:'Local deterministic wiring check',
    Intent:{qubits:1, shots:16, gates:[{gate:'X', target:0}], measure:[0]}};
  const response = await quantumHttp(new Request('https://n.test/api/ops/v1/quantum/measure', {
    method:'POST', headers:{...headers, 'Content-Type':'application/json'}, body:stable(job)}), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.counts, {'1':16});
  assert.equal(result.hardwareExecution, false);
  assert.equal(result.treasuryWrites, false);
  const after = (await (await telemetryHttp(metricsRequest(), env)).json()).quantum.workload;
  assert.equal(after.instanceId, before.instanceId);
  assert.equal(after.window.succeeded, before.window.succeeded + 1);
  assert.equal(after.window.completedShots, before.window.completedShots + 16);
  assert.equal(after.activeJobs, 0);
  assert.equal(after.capacity.automaticScalingEnabled, false);
});

test('mobile shells permit hosted post-release updates without remote native-code execution', () => {
  const policy = JSON.parse(read('public/mobile-update-policy.json'));
  const android = read('mobile/android/app/src/main/java/xyz/numinalabs/app/NuminaLauncherActivity.java');
  assert.equal(policy.schema, 'numina.mobile-post-release-policy.v1');
  assert.equal(policy.hostedOrigin, 'https://numinalabs.xyz');
  assert.equal(policy.hostedEntryPoint, '/app');
  assert.equal(policy.postReleaseHostedUpdatesAllowed, true);
  assert.equal(policy.invariants.firstPartyHttpsOnly, true);
  assert.equal(policy.invariants.nativeMessageBridge, false);
  assert.equal(policy.invariants.nativeCredentialBridge, false);
  assert.equal(policy.invariants.remoteNativeCodeExecution, false);
  assert.equal(policy.invariants.storeSubmissionRequiredForNativeCapabilityChanges, true);
  assert.ok(configuration.includes('static let startURL = origin.appendingPathComponent("app")'));
  assert.ok(model.includes('configuration.defaultWebpagePreferences.allowsContentJavaScript = true'));
  assert.doesNotMatch(swift, /WKScriptMessageHandler|addScriptMessageHandler|evaluateJavaScript|URLSession/);
  assert.ok(android.includes('private static final Uri HOME = Uri.parse("https://numinalabs.xyz/app");'));
  assert.match(android, /extends LauncherActivity/);
  assert.doesNotMatch(android, /DexClassLoader|PathClassLoader|loadClass|Runtime.getRuntime|ProcessBuilder/);
  assert.ok(policy.nativeStoreUpdateRequired.includes('swift_java_or_native_executable_code'));
  assert.ok(policy.nativeStoreUpdateRequired.includes('new_native_permissions_or_entitlements'));
  assert.ok(policy.nativeStoreUpdateRequired.includes('downloaded_executable_code_that_changes_native_app_functionality'));
});
