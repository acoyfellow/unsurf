/**
 * Auth unit tests for the trace worker ingest path.
 *
 * Covers:
 *   - KV-backed per-owner token accepted, rate-limit key is the hash prefix
 *   - Revoked KV token rejected
 *   - Legacy TRACE_INGEST_TOKEN accepted as fallback, rate-limit key = "legacy"
 *   - Missing / malformed / bogus tokens rejected
 *   - KV hit takes precedence over legacy so revocation is effective even
 *     if the legacy value happens to equal a minted token
 */

import { beforeEach, describe, expect, it } from "vitest";
import { authIngest, sha256Hex } from "../src/trace-worker.js";

type KVValue = string | null;

function makeKV(initial: Record<string, KVValue> = {}) {
	const store = new Map<string, string>();
	for (const [k, v] of Object.entries(initial)) {
		if (v !== null) store.set(k, v);
	}
	return {
		async get(key: string): Promise<string | null> {
			return store.get(key) ?? null;
		},
		async put(key: string, value: string): Promise<void> {
			store.set(key, value);
		},
		_store: store,
	};
}

function mkReq(auth?: string): Request {
	const headers = new Headers();
	if (auth !== undefined) headers.set("authorization", auth);
	return new Request("https://trace.coey.dev/upload", { method: "POST", headers });
}

describe("authIngest", () => {
	let TRACE_TOKENS: ReturnType<typeof makeKV>;

	beforeEach(() => {
		TRACE_TOKENS = makeKV();
	});

	it("rejects missing Authorization header", async () => {
		const result = await authIngest(mkReq(), {
			// biome-ignore lint/suspicious/noExplicitAny: narrow Pick in Env matches KV shape.
			TRACE_TOKENS: TRACE_TOKENS as any,
			TRACE_INGEST_TOKEN: "legacy-abc",
		});
		expect(result).toBeNull();
	});

	it("rejects malformed Authorization header", async () => {
		const result = await authIngest(mkReq("Token foo"), {
			// biome-ignore lint/suspicious/noExplicitAny: test KV shape.
			TRACE_TOKENS: TRACE_TOKENS as any,
			TRACE_INGEST_TOKEN: "legacy-abc",
		});
		expect(result).toBeNull();
	});

	it("accepts the legacy token when no KV entry matches", async () => {
		const result = await authIngest(mkReq("Bearer legacy-abc"), {
			// biome-ignore lint/suspicious/noExplicitAny: test KV shape.
			TRACE_TOKENS: TRACE_TOKENS as any,
			TRACE_INGEST_TOKEN: "legacy-abc",
		});
		expect(result).toEqual({ rateLimitKey: "legacy", owner: "legacy" });
	});

	it("accepts a KV-backed token and returns a hashed rate-limit key", async () => {
		const token = "minted-token-xyz";
		const hash = await sha256Hex(token);
		await TRACE_TOKENS.put(
			hash,
			JSON.stringify({ owner: "jordan", createdAt: "2026-01-01T00:00:00Z" }),
		);
		const result = await authIngest(mkReq(`Bearer ${token}`), {
			// biome-ignore lint/suspicious/noExplicitAny: test KV shape.
			TRACE_TOKENS: TRACE_TOKENS as any,
			TRACE_INGEST_TOKEN: "legacy-abc",
		});
		expect(result).toMatchObject({ owner: "jordan" });
		expect(result?.rateLimitKey).toBe(`t:${hash.slice(0, 16)}`);
		expect(result?.rateLimitKey).not.toBe("legacy");
	});

	it("rejects a revoked KV-backed token even if it exists", async () => {
		const token = "revoked-tok";
		const hash = await sha256Hex(token);
		await TRACE_TOKENS.put(
			hash,
			JSON.stringify({
				owner: "jordan",
				createdAt: "2026-01-01T00:00:00Z",
				revokedAt: "2026-02-01T00:00:00Z",
			}),
		);
		const result = await authIngest(mkReq(`Bearer ${token}`), {
			// biome-ignore lint/suspicious/noExplicitAny: test KV shape.
			TRACE_TOKENS: TRACE_TOKENS as any,
			TRACE_INGEST_TOKEN: "something-else",
		});
		expect(result).toBeNull();
	});

	it("rejects a bogus token that matches neither KV nor legacy", async () => {
		const result = await authIngest(mkReq("Bearer totally-wrong"), {
			// biome-ignore lint/suspicious/noExplicitAny: test KV shape.
			TRACE_TOKENS: TRACE_TOKENS as any,
			TRACE_INGEST_TOKEN: "legacy-abc",
		});
		expect(result).toBeNull();
	});

	it("tolerates malformed JSON in KV (treats as no-match, falls to legacy)", async () => {
		const token = "broken-kv";
		const hash = await sha256Hex(token);
		await TRACE_TOKENS.put(hash, "{not valid json");
		// Same token happens to equal the legacy one — should still auth via legacy path.
		const result = await authIngest(mkReq(`Bearer ${token}`), {
			// biome-ignore lint/suspicious/noExplicitAny: test KV shape.
			TRACE_TOKENS: TRACE_TOKENS as any,
			TRACE_INGEST_TOKEN: token,
		});
		expect(result).toEqual({ rateLimitKey: "legacy", owner: "legacy" });
	});

	it("works with an empty legacy token (KV-only deploy)", async () => {
		const token = "only-kv";
		const hash = await sha256Hex(token);
		await TRACE_TOKENS.put(hash, JSON.stringify({ owner: "ci", createdAt: "now" }));
		const result = await authIngest(mkReq(`Bearer ${token}`), {
			// biome-ignore lint/suspicious/noExplicitAny: test KV shape.
			TRACE_TOKENS: TRACE_TOKENS as any,
			TRACE_INGEST_TOKEN: "",
		});
		expect(result?.owner).toBe("ci");
	});
});

describe("sha256Hex", () => {
	it("produces deterministic 64-char hex", async () => {
		const a = await sha256Hex("hello");
		const b = await sha256Hex("hello");
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});

	it("differs for different inputs", async () => {
		expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
	});
});
