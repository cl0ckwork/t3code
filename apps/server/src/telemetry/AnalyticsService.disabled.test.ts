import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import * as AnalyticsService from "./AnalyticsService.ts";

it.effect("the disabled analytics layer queues nothing and needs no identity", () =>
  Effect.gen(function* () {
    const analytics = yield* AnalyticsService.AnalyticsService;
    assert.isFalse(yield* analytics.record("turn.completed", { model: "custom-model" }));
    yield* analytics.recordOwners([{ source: "claude", ownerId: "a".repeat(64) }], "server");
    yield* analytics.flush;
  }).pipe(Effect.provide(AnalyticsService.layerDisabled)),
);
