# Task 2: Heal Effectiveness Report

**Generated**: 2026-02-16T21:53:06.597Z
**Target**: https://unsurf-api.coey.dev

## Summary

| Metric | Value |
|--------|-------|
| Sites targeted | 10 |
| Sites scouted successfully | 10 (100.0%) |
| Worker success (pre-heal) | 2 / 10 |
| Heal attempts | 10 |
| **Heal successes** | **2 (20.0%)** |
| Heal failures | 8 |
| Avg heal time | 5.5s |
| New paths created (re-scout) | 0 |

## Heal Mechanism Breakdown

| Mechanism | Count | Description |
|-----------|-------|-------------|
| Retry success | 2 | Worker succeeded on retry (transient error was simulated, but endpoint was live) |
| Re-scout success | 0 | Heal re-scouted the URL and got a new working path |
| Failed | 8 | Neither retry nor re-scout fixed the issue |

## Results by Site

| URL | Endpoints | Gallery? | Worker OK | Heal | New Path | Heal Time |
|-----|-----------|----------|-----------|------|----------|-----------|
| jsonplaceholder.typicode.com | 1 | yes | ✗ | ✗ | no | 6.0s |
| pokeapi.co | 10 | yes | ✗ | ✗ | no | 6.3s |
| catfact.ninja | 1 | yes | ✗ | ✗ | no | 5.9s |
| api.open-meteo.com | 4 | yes | ✗ | ✗ | no | 5.7s |
| api.frankfurter.app | 1 | **no** | ✓ | ✓ | no | 1.4s |
| restcountries.com | 1 | yes | ✗ | ✗ | no | 7.4s |
| dog.ceo | 5 | yes | ✗ | ✗ | no | 7.7s |
| icanhazdadjoke.com | 10 | yes | ✗ | ✗ | no | 6.6s |
| api.dictionaryapi.dev | 1 | no | ✗ | ✗ | no | 6.5s |
| httpbin.org | 2 | yes | ✓ | ✓ | no | 1.7s |

## Root Cause Analysis

### Primary failure: relative path patterns in gallery-cached specs

8/10 sites were served from the gallery cache. These gallery specs store **relative path patterns** (e.g., `/posts`, `/api/v2/ability`, `/fact`) instead of absolute URLs. When Worker tries to replay these via `fetch()`, it gets `TypeError: Invalid URL: /posts` because Cloudflare Workers' `fetch()` requires absolute URLs.

**Evidence**:
- Worker errors all follow the pattern: `Fetch failed: TypeError: Invalid URL: <relative-path>`
- The 2 successes (frankfurter.app, httpbin.org) either:
  - Were freshly scouted with absolute URLs (frankfurter — not in gallery)
  - Had gallery specs with absolute URLs (httpbin)

### Why heal can't fix this

Heal's recovery flow:
1. **Retry worker** with exponential backoff → fails again (same relative URL)
2. **Re-scout** the original URL → hits gallery cache again → gets same relative paths
3. **Worker on new path** → same `Invalid URL` error → returns `{ healed: false }`

The heal tool cannot bypass the gallery cache (no `force: true` option passed through), so it's stuck in a loop of getting the same broken paths.

### Per-site worker errors

| Site | Worker Error |
|------|-------------|
| jsonplaceholder.typicode.com | `Invalid URL: /posts` |
| pokeapi.co | `Invalid URL: /api/v2/ability` |
| catfact.ninja | `Invalid URL: /fact` |
| api.open-meteo.com | `Invalid URL: /v1/archive` |
| restcountries.com | `Invalid URL: /v3.1/all` |
| dog.ceo | `Invalid URL: /api/breed/{breed}/images` |
| icanhazdadjoke.com | `Invalid URL: /` |
| api.dictionaryapi.dev | `HTTP 404 Not Found` |

### api.dictionaryapi.dev — different failure mode

This site was freshly scouted (not from gallery) but returned HTTP 404. Its captured endpoint path may have changed or been incorrectly normalized. This is a legitimate heal scenario, but heal failed because re-scout captured the same path.

## Recommendations

1. **Fix gallery path storage**: Gallery specs should store absolute URLs (`https://api.example.com/v1/data`) not relative paths (`/v1/data`). This is the root cause of 7/8 failures.

2. **Heal should use `force: true` for re-scout**: When retries fail and heal re-scouts, it should bypass the gallery cache to get fresh browser-captured paths. Currently Heal calls `scout()` without `force: true`.

3. **Worker should resolve relative paths**: As a defense-in-depth fix, Worker should resolve relative pathPatterns against the site's base URL before calling `fetch()`.

4. **Projected heal rate after fixes**:
   - If gallery paths were absolute: worker would succeed on ~8/10 sites
   - Heal via retry would succeed on those 8 (the endpoints are live)
   - Estimated heal rate: **80-90%** (above the 60% target)

## Methodology

1. **Scout phase**: 10 target URLs scouted via `POST /tools/scout`. All succeeded — 8 from gallery cache, 2 fresh.
2. **Worker phase**: Each pathId tested via `POST /tools/worker`. Only 2/10 succeeded.
3. **Heal phase**: Each pathId passed to `POST /tools/heal` with a simulated error. Heal retries worker with exponential backoff (500ms, 1s, 2s × 2 retries), then re-scouts on failure.

### Simulated Errors Used
- Simulated: endpoint returned 500 Internal Server Error
- Simulated: endpoint returned 502 Bad Gateway
- Simulated: endpoint returned 404 Not Found - path may have changed
- Simulated: connection refused - service may be down
- Simulated: response was HTML instead of JSON
- Simulated: endpoint returned 403 Forbidden
- Simulated: request timed out after 30s
- Simulated: SSL certificate expired
- Simulated: unexpected EOF in response body
- Simulated: DNS resolution failed for host

## Conclusion

The heal tool achieves **20% success rate** against the 60% target. However, this is primarily due to a **gallery path storage bug** (relative vs absolute URLs) rather than a fundamental heal design flaw. The heal algorithm itself (retry → re-scout → verify) is sound. Fixing the gallery path storage + adding `force: true` to heal's re-scout would likely bring the rate to **80-90%**.
