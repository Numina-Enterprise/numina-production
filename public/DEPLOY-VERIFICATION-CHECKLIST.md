# Deploy-verification checklist — after PR #204 merges + deploys (Workstream C, Nov 19, 2026)

Pipeline (Nov 16, owner-set): preserve → validate → review branch → verify CI → merge
with approval → deploy → verify production. This checklist covers the last stage only.
Do NOT run the production checks until the deploy workflow reports green — a red
checklist before deploy proves nothing except that the old site is still live.

## Preconditions (before reading any result below)

- [ ] PR #204 merged with owner approval (merge auto-deploys; #202 attestation failure must be resolved first — see parent coordinator).
- [ ] `deploy-cloudflare.yml` run green for the merge commit (Cloudflare deploy receipt).
- [ ] Owner decisions D1 (republish `/economy` + `/blockchain`) and D2 (Nov 5–6 receipt) answered — see `INFRA-ASKS.md`. If D1 = keep-retired, skip the `/economy` + `/blockchain` rows and expect the retired stubs to remain.
- [ ] Wait for CDN propagation if a check fails once: re-run that single check after 2 minutes before calling it a failure. Never "verify" by re-reading a cached copy.

## Production checks — run in order, Mac Terminal or any shell

```bash
# 1. Homepage — new title, $5,000 live, $1,500 gone
curl -s -o /tmp/v-home.html -w "home HTTP %{http_code} %{size_download}B\n" https://numinalabs.xyz/
grep -o '<title>[^<]*</title>' /tmp/v-home.html
# EXPECT: <title>Engineering the Next Generation of Independent Intelligence | NUMINA</title>
grep -c '\$5,000' /tmp/v-home.html   # EXPECT: >= 1
grep -c '\$1,500' /tmp/v-home.html   # EXPECT: 0

# 2. NN/LLM page live
curl -s -o /tmp/v-nn.html -w "nn-llm HTTP %{http_code} %{size_download}B\n" https://numinalabs.xyz/nn-llm
# EXPECT: HTTP 200, size ~28,500B
grep -o '<title>[^<]*</title>' /tmp/v-nn.html
# EXPECT: title contains "Numina-NN / Numina-LLM"

# 3. Master spec live
curl -s -o /tmp/v-ms.html -w "master-spec HTTP %{http_code} %{size_download}B\n" https://numinalabs.xyz/master-spec
# EXPECT: HTTP 200, size ~58,000B
grep -o '<title>[^<]*</title>' /tmp/v-ms.html
# EXPECT: title contains "Master Technical Integration"

# 4. Services — $5,000 live, $1,500 gone (all 7 occurrences)
curl -s -o /tmp/v-svc.html -w "services HTTP %{http_code} %{size_download}B\n" https://numinalabs.xyz/services
# EXPECT: HTTP 200
grep -c '\$5,000' /tmp/v-svc.html   # EXPECT: >= 5
grep -c '\$1,500' /tmp/v-svc.html   # EXPECT: 0

# 5. Testnet live
curl -s -o /dev/null -w "testnet HTTP %{http_code}\n" https://numinalabs.xyz/testnet
# EXPECT: HTTP 200

# 6. Economy + blockchain republished with Nov 5-6 contracts (only if D1 = republish)
curl -s -o /tmp/v-eco.html -w "economy HTTP %{http_code}\n" https://numinalabs.xyz/economy
curl -s -o /tmp/v-blk.html -w "blockchain HTTP %{http_code}\n" https://numinalabs.xyz/blockchain
# EXPECT: HTTP 200 each, and NEITHER body contains "Page retired"
grep -c 'Page retired' /tmp/v-eco.html /tmp/v-blk.html   # EXPECT: 0 and 0
grep -c '0x5fbdb2315678afecb367f032d93f642f64180aa3' /tmp/v-eco.html /tmp/v-blk.html  # EXPECT: 1 and 1
grep -c '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512' /tmp/v-eco.html /tmp/v-blk.html  # EXPECT: 1 and 1
grep -c 'historical deployment record' /tmp/v-eco.html /tmp/v-blk.html            # EXPECT: 1 and 1
# Sep-18 address must appear ONLY inside the historical sentence:
grep -o '0x491c1DF1b5CA77AF797f052c2310ca17039C931b' /tmp/v-eco.html | wc -l  # EXPECT: 1
grep -o '0x491c1DF1b5CA77AF797f052c2310ca17039C931b' /tmp/v-blk.html | wc -l  # EXPECT: 1

# 7. Clean-URL redirects for the new pages
curl -s -o /dev/null -w "nn-llm.html -> %{http_code} %{redirect_url}\n" https://numinalabs.xyz/nn-llm.html
# EXPECT: 301 https://numinalabs.xyz/nn-llm
curl -s -o /dev/null -w "master-spec.html -> %{http_code} %{redirect_url}\n" https://numinalabs.xyz/master-spec.html
# EXPECT: 301 https://numinalabs.xyz/master-spec
curl -s -o /dev/null -w "testnet.html -> %{http_code} %{redirect_url}\n" https://numinalabs.xyz/testnet.html
# EXPECT: 301 https://numinalabs.xyz/testnet

# 8. Sitemap carries the new pages
curl -s https://numinalabs.xyz/sitemap.xml | grep -c 'numinalabs.xyz/nn-llm\|numinalabs.xyz/master-spec\|numinalabs.xyz/testnet'
# EXPECT: 3
curl -s https://numinalabs.xyz/sitemap.xml | grep -c '<url>'
# EXPECT: 40

# 9. Header nav on a sample page links NN/LLM + Research
curl -s https://numinalabs.xyz/services | grep -o 'href="/nn-llm"' | wc -l  # EXPECT: >= 2 (desktop + mobile nav)
curl -s https://numinalabs.xyz/services | grep -o 'href="/master-spec"' | wc -l  # EXPECT: >= 2

# 10. Sign-in route (only after Gap 3 is applied; SKIP until then — expect 404 today)
curl -s -o /dev/null -w "signin HTTP %{http_code} %{redirect_url}\n" "https://numinalabs.xyz/signin-with-chatgpt?return_to=%2Fapp"
# EXPECT AFTER GAP 3: 302 to the Sites host sign-in URL. EXPECT TODAY (unapplied): 404.
```

## Pass / fail rules

- **PASS** = every EXPECT above holds. Record the run (date, commit SHA, curl outputs) in the release evidence.
- **FAIL on any row** = stop, record the exact failing check + HTTP code + body excerpt, and do NOT re-run the deploy or edit the live site to force it green. A stale result means the deploy did not land (check the deploy workflow run first) or the CDN is still propagating (wait 2 minutes, re-run that one check once).
- The `$1,500` checks are the highest-signal rows: any `$1,500` remaining on `/` or `/services` after deploy means the old bundle is still serving.
- `/economy` + `/blockchain` showing "Page retired" after deploy means either D1 was keep-retired (expected) or the deploy did not include the staged pages (failure — check the merge commit contents).
