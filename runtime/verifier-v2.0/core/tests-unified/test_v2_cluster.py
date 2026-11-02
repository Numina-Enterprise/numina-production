"""V2.0 unified Python test — dependency-free (stdlib only)."""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "interface"))
from cluster import GENESIS_HASH, GENESIS_CHAIN_ID, GENESIS_BLOCK, V2_CLUSTER_ROOT

class TestV2Cluster(unittest.TestCase):
    def test_genesis_identity(self):
        self.assertEqual(GENESIS_HASH, "0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1")
        self.assertEqual(GENESIS_CHAIN_ID, 962421430)
        self.assertEqual(GENESIS_BLOCK, 0)
        self.assertEqual(V2_CLUSTER_ROOT, GENESIS_HASH)

if __name__ == "__main__":
    unittest.main()
