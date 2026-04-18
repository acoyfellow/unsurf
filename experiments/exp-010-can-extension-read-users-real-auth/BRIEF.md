# exp-010-can-extension-read-users-real-auth

## Question
Determine whether a Chrome MV3 content script on `https://github.com/*` inherits the user's logged-in GitHub session such that `document.cookie`, `fetch(..., { credentials: "include" })`, and `window.localStorage` all act as the authenticated user without additional auth plumbing.

## Why this question
This is the load-bearing assumption behind the extension path for WebMCP capture: that synthesized tools executed in the user's real browser inherit the user's real session "for free." If this is true, invisible auth is solved and synthesis/execution can live in an extension. If it is false (CORS blocks, SameSite cookies hidden from content scripts, SPA hydration races), we must pivot synthesis and execution into Browser Rendering with explicit session transfer. This rules out or rules in the entire extension-first architecture referenced as North Star #1 in JORDAN.md.

## Method
1. Create `experiments/exp-010-can-extension-read-users-real-auth/extension/` containing a minimal MV3 extension:
   - `manifest.json` with `"manifest_version": 3`, `content_scripts` matching `https://github.com/*`, `host_permissions` for `https://github.com/*`, `https://api.github.com/*`, `https://mail.google.com/*`, `https://accounts.google.com/*`, `https://<any-saas-with-okta>.okta.com/*` (or an equivalent enterprise-SSO-protected site the experimenter has access to), and a `sidebar_action` or `side_panel` entry for displaying probe results.
   - `content.js` that runs at `document_idle` and performs three probes:
     a. `document.cookie` — log presence (boolean) and count of `;`-separated entries. Do NOT log cookie contents.
     b. `fetch("https://api.github.com/user", { credentials: "include" })` — log HTTP status, whether the JSON response contains a `login` field, and whether `login` matches the username visible in the page DOM (via the `meta[name="user-login"]` tag or the header avatar link).
     c. `window.localStorage` — log the keys (names only, not values), count, and whether any key contains the substring `user` or `session`.
   - `sidepanel.html` + `sidepanel.js` that receive results via `chrome.runtime.sendMessage` and render them as a three-row table.
2. Load the unpacked extension in Chrome stable.
3. Run probes against THREE auth models: (M1) Cookie-only session: github.com (existing probe, keep unchanged). (M2) OAuth/OIDC SSO: mail.google.com — probe document.cookie, fetch(https://gmail.googleapis.com/gmail/v1/users/me/profile, {credentials: include}), and localStorage. (M3) Enterprise SSO: an Okta-or-Entra-protected SaaS the experimenter has access to (Linear with enterprise SSO, a Cloudflare internal app, etc.) — probe document.cookie and one authenticated fetch to that sites API.
4. Negative control: run the probe on chrome://settings — expect ALL probes to fail (extension must not have access to browser UI pages). Log that failures occur as expected.
5. Record per auth-model: which of the three probes (cookie/fetch/localStorage) succeeded, and which gotcha applied (CORS, SameSite, Storage Partitioning, WebAuthn required, auth expired mid-probe). Specifically check: does cross-origin fetch with credentials: include require host_permissions to be declared for BOTH origins (e.g. both mail.google.com and gmail.googleapis.com)?
6. Run the same probe on a hard-reloaded page (Cmd+Shift+R) to test hydration timing — does the API call succeed immediately at `document_idle`, or only after a delay?
7. Document every failure mode (CORS preflight failure, `credentials: "include"` being stripped, cookies filtered, `localStorage` empty due to partitioning) with the exact error string.

## Inputs
- A GitHub account the experimenter is logged into in Chrome stable.
- Chrome with developer mode enabled for unpacked extensions.
- No prior experiment outputs required.

## Outputs
- `experiments/exp-010-can-extension-read-users-real-auth/extension/` — the minimal MV3 extension source.
- `experiments/exp-010-can-extension-read-users-real-auth/RESULT.md` documenting:
  - Pass/Fail/Ambiguous.
  - For each of the three probes: worked / failed / worked with caveats (+ exact caveat).
  - A "gotchas" section listing anything unexpected (CORS, SameSite, hydration, partitioning, MV3 quirks).
  - A graduation recommendation for `examples/webmcp-extension/`.
- No `tool-spec.v0.json` is produced or consumed.

## Kill-by
1 hour. If MV3 boilerplate, manifest reloading, or Chrome profile issues eat the budget, write RESULT.md with "Ambiguous — blocked on plumbing" and stop.

## Pass / Fail / Ambiguous criteria
- **Pass**: ALL three auth models (cookie, OAuth SSO, enterprise SSO) allow the content script to read at least ONE signal of the authenticated session without additional OAuth flows AND the negative control (chrome://settings) correctly denies access. Partial pass (e.g. works on cookie sessions but not enterprise SSO) is Ambiguous, not Pass.
- **Fail**: Any probe fails in a way that cannot be trivially worked around from a content script alone (e.g. `api.github.com` CORS rejects the request even with `credentials: "include"`, or cookies are invisible to the content script due to `HttpOnly` + SameSite combined with extension-origin isolation).
- **Ambiguous**: Probes succeed on some URLs/reload states but not others, OR succeed only after ≥2s hydration delay, OR require `host_permissions` / `declarativeNetRequest` workarounds that make the path meaningfully more complex than "content script just reads the page."

## What could surprise us
1. `fetch` to `api.github.com` from a content script requires the extension to declare `host_permissions` for `api.github.com` explicitly — otherwise the request goes out as a "third-party" fetch without cookies, even with `credentials: "include"`. This would mean every synthesized tool needs its target API origin declared up front, which complicates the "works on any site" pitch.
2. GitHub's `localStorage` is nearly empty or contains only feature-flag cruft — the useful session state lives entirely in `HttpOnly` cookies and a server-rendered `meta` tag. Synthesis can't rely on `localStorage` as a signal.
3. Chrome's Storage Partitioning (rolled out for third-party contexts) affects content-script `localStorage` access in ways that differ between top-level and iframed GitHub pages — meaning tools that work on the main page silently break inside embedded views.

## Integration target
If Pass: confirms the extension-first auth model and graduates the extension skeleton into `examples/webmcp-extension/` as the same package that exp-004 contributes to. No changes to `src/` of unsurf itself. Updates the "browser is the auth" claim in JORDAN.md North Star #1 from hypothesis to fact.

If Fail: pivots synthesis+execution into Browser Rendering (`src/services/Browser.ts`), which means the user's auth must be transferred explicitly (cookie jar, bearer token, or device-flow), and the extension-first pitch in JORDAN.md is downgraded.

This experiment is THESIS-GATING (see THESIS.md). A Fail — particularly on enterprise SSO, which is Cloudflares customer profile — means the extension-first pitch must be pivoted to a Browser Rendering + explicit-cookie-transfer architecture. Pass confirms invisible-auth works at the target customer tier, not just on consumer sites.

## Contract interaction
Neither produces nor consumes `tool-spec.v0.json`. This experiment is purely an auth-inheritance probe. The only contract-adjacent note: CONTRACT.md v0 "Non-goals" already states "Authentication state (the runner inherits the user's browser session; not a spec concern)" — this experiment is what makes that sentence either true or a lie.

## Out of scope
- Building any synthesizer, tool runner, or DSL execution path. This is auth plumbing only.
- Testing sites other than GitHub. One site is enough to answer the question; generalization is exp-012's problem.
- Handling OAuth flows, token refresh, or re-authentication. The user is assumed already logged in.
- Measuring performance of the probes. Success/failure is binary here, not latency-sensitive.
- Writing a Firefox / Safari version of the extension. Chrome MV3 only.
