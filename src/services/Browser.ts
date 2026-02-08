import { Context, Effect, Layer, Stream } from "effect";
import type { BrowserError } from "../domain/Errors.js";
import type { NetworkEvent } from "../domain/NetworkEvent.js";

export interface BrowserService {
	readonly navigate: (url: string) => Effect.Effect<void, BrowserError>;
	readonly captureNetwork: () => Effect.Effect<
		Stream.Stream<NetworkEvent, BrowserError>,
		BrowserError
	>;
	readonly screenshot: () => Effect.Effect<Uint8Array, BrowserError>;
	readonly evaluate: <T>(fn: () => T) => Effect.Effect<T, BrowserError>;
	readonly close: () => Effect.Effect<void>;
}

export class Browser extends Context.Tag("Browser")<Browser, BrowserService>() {}

export const BrowserStub = Layer.succeed(Browser, {
	navigate: () => Effect.void,
	captureNetwork: () => Effect.succeed(Stream.empty),
	screenshot: () => Effect.succeed(new Uint8Array()),
	evaluate: () => Effect.succeed(undefined as never),
	close: () => Effect.void,
});
