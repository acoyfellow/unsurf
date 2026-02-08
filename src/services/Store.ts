import { Context, Effect, Layer } from "effect";
import type { CapturedEndpoint } from "../domain/Endpoint.js";
import type { NotFoundError, StoreError } from "../domain/Errors.js";
import type { ScoutedPath } from "../domain/Path.js";
import type { Site } from "../domain/Site.js";

export interface StoreService {
	readonly saveSite: (site: Site) => Effect.Effect<void, StoreError>;
	readonly getSite: (id: string) => Effect.Effect<Site, NotFoundError | StoreError>;
	readonly saveEndpoints: (
		endpoints: ReadonlyArray<CapturedEndpoint>,
	) => Effect.Effect<void, StoreError>;
	readonly getEndpoints: (
		siteId: string,
	) => Effect.Effect<ReadonlyArray<CapturedEndpoint>, StoreError>;
	readonly savePath: (path: ScoutedPath) => Effect.Effect<void, StoreError>;
	readonly getPath: (id: string) => Effect.Effect<ScoutedPath, NotFoundError | StoreError>;
	readonly listPaths: (siteId: string) => Effect.Effect<ReadonlyArray<ScoutedPath>, StoreError>;
	readonly saveBlob: (key: string, data: Uint8Array) => Effect.Effect<void, StoreError>;
}

export class Store extends Context.Tag("Store")<Store, StoreService>() {}

export const StoreStub = Layer.succeed(Store, {
	saveSite: () => Effect.void,
	getSite: () =>
		Effect.succeed({ id: "", url: "", domain: "", firstScoutedAt: "", lastScoutedAt: "" } as Site),
	saveEndpoints: () => Effect.void,
	getEndpoints: () => Effect.succeed([]),
	savePath: () => Effect.void,
	getPath: () =>
		Effect.succeed({
			id: "",
			siteId: "",
			task: "",
			steps: [],
			endpointIds: [],
			status: "active",
			createdAt: "",
			failCount: 0,
			healCount: 0,
		} as unknown as ScoutedPath),
	listPaths: () => Effect.succeed([]),
	saveBlob: () => Effect.void,
});
