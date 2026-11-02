// V2.0 unified tests — dependency-free (Node builtins only).
import test from "node:test";
import assert from "node:assert/strict";
import { GENESIS_CLUSTER_ROOT, CANONICAL_CLUSTER_STATE_ROOT } from "../financial/src/rwa-tokenization-engine.mjs";
import { SettlementRailConnector } from "../financial/src/settlement-rail-connector.mjs";
import { loadConnectorConfig, assertReadOnlyConfig } from "../financial/src/connector-config.mjs";

const GENESIS = "0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1";

test("V2.0 cluster root is the Genesis hash, not the quarantined root", () => {
  assert.equal(GENESIS_CLUSTER_ROOT, GENESIS);
  assert.equal(CANONICAL_CLUSTER_STATE_ROOT, GENESIS);
});

test("settlement submission still fails closed (DRY_RUN_REJECTED_BY_GATE)", () => {
  const c = new SettlementRailConnector({ config: loadConnectorConfig(), authProvider: async () => "MOCK_ONLY_TEST_TOKEN" });
  assert.throws(() => c.submitTransfer(), /DRY_RUN_REJECTED_BY_GATE/);
});

test("connector config remains READ_ONLY and external writes disabled", () => {
  const cfg = loadConnectorConfig();
  assert.equal(cfg.mode, "READ_ONLY");
  assert.equal(cfg.settlement.allowSettlementSubmission, false);
  assert.equal(cfg.ncua.submissionEnabled, false);
  assert.equal(assertReadOnlyConfig(cfg), true);
});
