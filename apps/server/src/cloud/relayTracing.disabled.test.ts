import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, it, vi } from "@effect/vitest";
import * as RelayTracing from "@t3tools/shared/relayTracing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.effect("the server exports no relay traces even when an endpoint is configured", () =>
  Effect.gen(function* () {
    vi.stubEnv("T3CODE_RELAY_CLIENT_OTLP_TRACES_URL", "https://traces.example.com");
    vi.stubEnv("T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET", "relay");
    vi.stubEnv("T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN", "token");
    vi.resetModules();
    // The tracing config is read when the module loads, so load it after the env is set.
    const { relayLayer } = yield* Effect.promise(() => import("./relayTracing.ts"));

    const tracer = yield* Effect.service(RelayTracing.RelayClientTracer).pipe(
      Effect.provide(
        relayLayer({
          serviceName: "t3code-server",
          runtime: "node",
          client: "environment-server",
        }).pipe(
          Layer.provide(ManagedPolicy.layerTest()),
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-relay-tracing-off-" }).pipe(
              Layer.provide(NodeServices.layer),
            ),
          ),
          Layer.provide(FetchHttpClient.layer),
        ),
      ),
    );
    assert.isTrue(Option.isNone(tracer));
  }),
);
