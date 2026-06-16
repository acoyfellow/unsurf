import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openCmuxBrowser } from "../src/skills/record/index.js";

async function fakeCmux(): Promise<{ bin: string; log: string }> {
	const dir = await mkdtemp(path.join(tmpdir(), "unsurf-cmux-test-"));
	const bin = path.join(dir, "cmux");
	const log = path.join(dir, "calls.jsonl");
	await writeFile(
		bin,
		`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@")" >> ${JSON.stringify(log)}
if [[ "$*" == *" browser open "* ]]; then
  printf '{"surface_ref":"surface:99"}\\n'
elif [[ "$*" == *" screenshot "* ]]; then
  out=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--out" ]]; then shift; out="$1"; break; fi
    shift
  done
  printf 'PNG' > "$out"
  printf '{"path":"%s"}\\n' "$out"
elif [[ "$*" == *" snapshot "* ]]; then
  printf '{"snapshot":"- button Submit","surface_ref":"surface:99"}\\n'
else
  printf '{"ok":true}\\n'
fi
`,
	);
	await chmod(bin, 0o755);
	return { bin, log };
}

describe("cmux browser provider", () => {
	it("opens an explicit surface and declares honest WKWebView capabilities", async () => {
		const fake = await fakeCmux();
		const browser = await openCmuxBrowser({ bin: fake.bin, workspace: "workspace:7" });
		expect(browser.surface).toBe("surface:99");
		expect(browser.capabilities).toEqual({
			snapshots: true,
			screenshots: true,
			eval: true,
			persistentAuth: true,
			humanTakeover: true,
			recording: false,
			tracing: false,
			network: false,
			isolation: "shared-profile",
		});
		await browser.close();
		const calls = (await readFile(fake.log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		expect(calls[0]).toEqual([
			"--json",
			"browser",
			"open",
			"about:blank",
			"--workspace",
			"workspace:7",
			"--focus",
			"false",
		]);
		expect(calls.at(-1)).toEqual(["--json", "browser", "surface:99", "close"]);
	});

	it("routes actions to one surface and returns snapshot/screenshot evidence", async () => {
		const fake = await fakeCmux();
		const browser = await openCmuxBrowser({ bin: fake.bin, surface: "surface:12", closeOnExit: false });
		await browser.goto("https://example.com");
		await browser.fill("#name", "Jordan");
		await browser.click("#submit");
		const snapshot = await browser.snapshot();
		const image = await browser.screenshot();
		expect(snapshot).toMatchObject({ snapshot: "- button Submit", surface_ref: "surface:99" });
		expect(new TextDecoder().decode(image)).toBe("PNG");
		await expect(browser.startRecording("/tmp/nope.webm")).rejects.toThrow(/does not support screencast/);
		await browser.close();

		const calls = (await readFile(fake.log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		expect(calls).toContainEqual(["--json", "browser", "surface:12", "navigate", "https://example.com"]);
		expect(calls).toContainEqual([
			"--json",
			"browser",
			"surface:12",
			"fill",
			"--selector",
			"#name",
			"--text",
			"Jordan",
		]);
		expect(calls).not.toContainEqual(["--json", "browser", "surface:12", "close"]);
	});
});
