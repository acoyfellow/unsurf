import { describe, expect, it } from "vitest";
import { openBrowserRunBrowser, recordBrowserRunSession } from "../src/skills/record/index.js";

describe("Browser Run provider exports", () => {
	it("ships hosted browsing and native cloud recording helpers", () => {
		expect(typeof openBrowserRunBrowser).toBe("function");
		expect(typeof recordBrowserRunSession).toBe("function");
	});
});
