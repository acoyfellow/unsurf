import { Context, Effect, Layer } from "effect";
import type { CapturedEndpoint } from "../domain/Endpoint.js";

export interface OpenApiGeneratorService {
	readonly generate: (
		siteUrl: string,
		endpoints: ReadonlyArray<CapturedEndpoint>,
	) => Effect.Effect<Record<string, unknown>>;
}

export class OpenApiGenerator extends Context.Tag("OpenApiGenerator")<
	OpenApiGenerator,
	OpenApiGeneratorService
>() {}

export const OpenApiGeneratorStub = Layer.succeed(OpenApiGenerator, {
	generate: (siteUrl) =>
		Effect.succeed({
			openapi: "3.1.0",
			info: { title: `API for ${siteUrl}`, version: "1.0.0" },
			paths: {},
		}),
});
