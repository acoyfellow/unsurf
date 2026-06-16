import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const port = 18_000 + Math.floor(Math.random() * 1_000);
const base = `http://127.0.0.1:${port}`;
let processHandle: ChildProcess;

beforeAll(async () => {
	processHandle = spawn("bun", ["fixture/server.ts"], {
		cwd: new URL("../", import.meta.url).pathname,
		env: { ...process.env, PORT: String(port) },
		stdio: "ignore",
	});
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			if ((await fetch(`${base}/health`)).ok) return;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("fixture did not start");
});

afterAll(() => processHandle?.kill());

describe("delayed completion fixture", () => {
	it("serves broken and fixed variants without disclosing the trigger in visible copy", async () => {
		const broken = await fetch(`${base}/broken`).then((r) => r.text());
		const fixed = await fetch(`${base}/fixed`).then((r) => r.text());
		expect(broken).toContain("Fixture build: <strong>broken</strong>");
		expect(fixed).toContain("Fixture build: <strong>fixed</strong>");
		expect(broken).not.toContain("Refresh now");
		expect(fixed).not.toContain("Refresh now");
	});
});
