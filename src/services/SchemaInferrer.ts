import { Context, Effect, Layer } from "effect";

export interface SchemaInferrerService {
	readonly infer: (samples: ReadonlyArray<unknown>) => Effect.Effect<Record<string, unknown>>;
	readonly merge: (
		a: Record<string, unknown>,
		b: Record<string, unknown>,
	) => Effect.Effect<Record<string, unknown>>;
}

export class SchemaInferrer extends Context.Tag("SchemaInferrer")<
	SchemaInferrer,
	SchemaInferrerService
>() {}

export const SchemaInferrerStub = Layer.succeed(SchemaInferrer, {
	infer: () => Effect.succeed({ type: "object" }),
	merge: (a) => Effect.succeed(a),
});
