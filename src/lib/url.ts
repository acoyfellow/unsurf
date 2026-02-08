const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;
const BASE64_RE = /^[A-Za-z0-9+/=]{16,}$/;
const HEX_RE = /^[0-9a-f]{8,}$/i;

export function normalizeUrlPattern(url: string): string {
	const parsed = new URL(url);
	const segments = parsed.pathname.split("/").map((segment) => {
		if (!segment) return segment;
		if (UUID_RE.test(segment)) return ":id";
		if (NUMERIC_RE.test(segment)) return ":id";
		if (BASE64_RE.test(segment)) return ":id";
		if (HEX_RE.test(segment)) return ":id";
		return segment;
	});
	return `${parsed.origin}${segments.join("/")}`;
}

export function extractDomain(url: string): string {
	return new URL(url).hostname;
}
