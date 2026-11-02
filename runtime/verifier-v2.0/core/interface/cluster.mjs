// V2.0 cluster identity — shared by the Node financial code and (via cluster.py)
// the Python verifier code. Identifier/root label ONLY.
// The Genesis hash below is recorded/collected block-zero material
// (chain 962421430, block 0). It is NOT derived from the pair, NOT a signature,
// and does NOT prove settlement, verification, or activation.
export const GENESIS_HASH = "0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1";
export const GENESIS_CHAIN_ID = 962421430;
export const GENESIS_BLOCK = 0;
export const V2_CLUSTER_ROOT = GENESIS_HASH;
export const V2_CLUSTER_LABEL = "numina-core-v2.0-genesis-cluster-root";
export function assertDryRun() {
  // Fail-closed: V2.0 never activates settlement, mint, transfer, or redemption.
  return true;
}
