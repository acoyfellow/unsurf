/**
 * Canonical trace id: 12 chars, base36. Collision-resistant within retention,
 * not a security primitive (signed URLs do the auth). Regex lives in index.ts.
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newTraceId(): string {
	// 12 chars of base36 ≈ 62 bits of entropy. Generate via crypto, not Math.random.
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	let id = "";
	for (let i = 0; i < 12; i++) {
		id += ALPHABET[bytes[i]! % 36];
	}
	return id;
}
