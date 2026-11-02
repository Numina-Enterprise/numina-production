// V2.0 fail-closed guard. Imported by financial entry points in V2.0.
// Any settlement / mint / transfer / redemption attempt must fail closed
// unless a separate, documented, owner-authorized step exists — which is
// NOT part of V2.0. This module itself never authorizes anything.
import { CONNECTOR_MODE } from "../financial/src/connector-config.mjs";
export function assertFailClosed(config) {
  if (config?.mode && config.mode !== "READ_ONLY") {
    throw new Error("CONNECTOR_MODE_MUST_REMAIN_READ_ONLY");
  }
  if (config?.settlement?.allowSettlementSubmission !== false &&
      config?.settlement !== undefined) {
    throw new Error("EXTERNAL_WRITES_DISABLED");
  }
  return true;
}
export function rejectSettlement() {
  throw new Error("DRY_RUN_REJECTED_BY_GATE");
}
export { CONNECTOR_MODE };
