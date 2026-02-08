import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { UnsurfApi } from "./Api.js";

export const ToolsLive = HttpApiBuilder.group(UnsurfApi, "Tools", (handlers) =>
	handlers
		.handle("scout", ({ payload }) =>
			Effect.succeed({
				siteId: "stub",
				endpointCount: 0,
				pathId: "stub",
				openApiSpec: {},
			}),
		)
		.handle("worker", ({ payload }) =>
			Effect.succeed({
				success: true,
			}),
		)
		.handle("heal", ({ payload }) =>
			Effect.succeed({
				healed: true,
			}),
		),
);

export const ApiLive =
	HttpApiBuilder.api(UnsurfApi).pipe(
		// Layer.provide(ToolsLive) — uncomment when handlers are wired
	);
