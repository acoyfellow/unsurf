import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

const ScoutInput = Schema.Struct({
	url: Schema.String,
	task: Schema.String,
});

const ScoutResult = Schema.Struct({
	siteId: Schema.String,
	endpointCount: Schema.Number,
	pathId: Schema.String,
	openApiSpec: Schema.Unknown,
});

const WorkerInput = Schema.Struct({
	pathId: Schema.String,
	data: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

const WorkerResult = Schema.Struct({
	success: Schema.Boolean,
	response: Schema.optional(Schema.Unknown),
});

const HealInput = Schema.Struct({
	pathId: Schema.String,
	error: Schema.optional(Schema.String),
});

const HealResult = Schema.Struct({
	healed: Schema.Boolean,
	newPathId: Schema.optional(Schema.String),
});

const ToolsGroup = HttpApiGroup.make("Tools")
	.add(HttpApiEndpoint.post("scout", "/tools/scout").addSuccess(ScoutResult).setPayload(ScoutInput))
	.add(
		HttpApiEndpoint.post("worker", "/tools/worker")
			.addSuccess(WorkerResult)
			.setPayload(WorkerInput),
	)
	.add(HttpApiEndpoint.post("heal", "/tools/heal").addSuccess(HealResult).setPayload(HealInput));

export const UnsurfApi = HttpApi.make("unsurf").add(ToolsGroup);
