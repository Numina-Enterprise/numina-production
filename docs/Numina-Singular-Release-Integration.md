# Numina singular release integration

One owner approval covers the combined Numina release. The canonical record is public/owner-approval.js and the root release manifest exposes its hash and content.

This source combines main f288d0048544f78ac51d60dcf578bd81b62d4b48 (tree 66668d8e2ffa69199e5165ce9cc3152cd0a7573a) with the published wallet work 039a38cfb8f727b1670580c5fb8820063f592ea1 (tree b6f588cac0eef99d048509d2031c10910d261684). Main changed 36 paths and wallet work changed 24 disjoint paths since common base 667d9fd02424acb9f58a1201c737a9fe019d154f. Incoming file bytes were checked against Git blob hashes before integration.

The merge preserves main's Node 24 root gateway, provider observation evidence, provenance checks, native source inventories and runtime identity. It adds the owner wallet controls, separate intent storage, additive migration and exact receipt verification. Root gateway wallet routes point to the canonical owner service.

Owner approval is recorded; no missing policy signature, independent finding, external reserve evidence or financial receipt is inferred from that approval. No financial write is performed by this software release. Android package identity, native binaries and their actual store status are retained.
