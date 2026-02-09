/**
 * Error handling — how unsurf uses typed errors for recovery routing.
 * This file is embedded in the docs and tested in CI.
 */
import { Effect } from "effect";
import { BrowserError, NetworkError, NotFoundError, PathBrokenError, StoreError } from "unsurf";

// Every error is a tagged class — you can match on _tag
const error = new PathBrokenError({
	pathId: "path_abc123",
	step: 2,
	reason: "POST /api/contact returned 404",
});

console.log(error._tag); // "PathBrokenError"
console.log(error.pathId); // "path_abc123"
console.log(error.reason); // "POST /api/contact returned 404"

// Use catchTag to route each error type to the right recovery
const program = Effect.fail(error).pipe(
	Effect.catchTag("PathBrokenError", (e) =>
		Effect.succeed(`Healing path ${e.pathId}: ${e.reason}`),
	),
	Effect.catchTag("NetworkError", (e) => Effect.succeed(`Retrying ${e.url}: ${e.message}`)),
	Effect.catchTag("NotFoundError", (e) => Effect.succeed(`Re-scouting: ${e.id} not found`)),
);

const result = Effect.runSync(program);
console.log(result);
// → "Healing path path_abc123: POST /api/contact returned 404"
