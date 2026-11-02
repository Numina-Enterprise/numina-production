"""V2.0 cluster identity — shared by Python verifier code and Node financial code.

Identifier/root label ONLY. The Genesis hash is recorded/collected block-zero
material (chain 962421430, block 0). It is NOT derived from the pair, NOT a
signature, and does NOT prove settlement, verification, or activation.
"""
GENESIS_HASH = "0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1"
GENESIS_CHAIN_ID = 962421430
GENESIS_BLOCK = 0
V2_CLUSTER_ROOT = GENESIS_HASH
V2_CLUSTER_LABEL = "numina-core-v2.0-genesis-cluster-root"
