# Frontier settlement metadata publication

The current Sites publication is built with `scripts/build-frontier-settlement.mjs`.

The previous homepage build pulled client files from the live website and replaced the generated Worker with a retained runtime. Publishing from the older editable source alone would regress the current site. This build uses a checked-in snapshot bound to the existing release inventory, then applies an explicit list of treasury metadata overlays. It requires no network reads during builds.

The canonical receipt is `numina:treasury:settlement:2026-09-19:v1`. It records one NUMINA treasury, three holdings (USD at Bank of America Savings 3486, USDC at the Stripe linked account, NUSD retained natively), 500,000,000,000,000 each, aggregate 1,500,000,000,000,000 NUSD, mint CONFIRMED, burned 0.

Build checks verify every baseline client hash, preserve the homepage and unrelated assets, and reverse the five runtime substitutions to verify all other deployed runtime bytes remain unchanged. The final release inventory, proof-client hash, integration manifest and application build pin are regenerated together. Raw native receipts and external-provider observations remain evidence records with their own sources.

The Stripe USDC deposit address is `0x736bd8f274dce00a8bb374edd85df0d2e631018e`, confirmed by the owner and already present in all three canonical native receipt copies. The published metadata and retained runtime address bindings are aligned to that address. The earlier address discrepancy is resolved. This correction does not submit a transfer.

Historical 6-decimal issuer policy and treasury-write-request files found only in the archival checkout are not introduced into the Sites source. Existing source metadata and the current public projection are aligned.

The current final-manifest aliases and current-environments metadata are synchronized to the exact final-build bytes and canonical receipt. The current integration ZIP is rebuilt from its file manifest and verified entry by entry; its published record and release digest are refreshed together. Historical versioned archives and signed native binaries retain their original bytes and provenance.

The Labs page links the canonical receipt and lists the final aggregate, three designated components, mint, burn and corrected USDC address. Signed treasury evidence includes the canonical native settlement in its hashed snapshot. Provider reconciliation, external funding verification and external submission readiness retain explicit source scopes. Reading or publishing this metadata does not submit a payment or modify a provider account.

The build uses Python's standard library to package the current integration archive. Set `NUMINA_PYTHON` to the Python executable when it is not on PATH.
