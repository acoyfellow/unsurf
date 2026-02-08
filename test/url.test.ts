import { describe, expect, it } from "vitest";
import { extractDomain, normalizeUrlPattern } from "../src/lib/url.js";

describe("normalizeUrlPattern", () => {
	it("replaces numeric IDs", () => {
		expect(normalizeUrlPattern("https://api.example.com/contacts/123")).toBe(
			"https://api.example.com/contacts/:id",
		);
	});

	it("replaces UUIDs", () => {
		expect(
			normalizeUrlPattern("https://api.example.com/contacts/550e8400-e29b-41d4-a716-446655440000"),
		).toBe("https://api.example.com/contacts/:id");
	});

	it("replaces multiple segments", () => {
		expect(normalizeUrlPattern("https://api.example.com/users/123/posts/456")).toBe(
			"https://api.example.com/users/:id/posts/:id",
		);
	});

	it("preserves static segments", () => {
		expect(normalizeUrlPattern("https://api.example.com/v1/contacts/search")).toBe(
			"https://api.example.com/v1/contacts/search",
		);
	});
});

describe("extractDomain", () => {
	it("extracts hostname", () => {
		expect(extractDomain("https://api.example.com/foo")).toBe("api.example.com");
	});
});
