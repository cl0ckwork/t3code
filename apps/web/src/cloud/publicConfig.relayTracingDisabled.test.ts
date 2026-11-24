import { afterEach, expect, it, vi } from "vite-plus/test";

import { resolveRelayTracingConfig } from "./publicConfig.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("exports no relay traces even when a build configures an endpoint", () => {
  vi.stubEnv("VITE_RELAY_OTLP_TRACES_URL", "https://traces.example.com");
  vi.stubEnv("VITE_RELAY_OTLP_TRACES_DATASET", "relay");
  vi.stubEnv("VITE_RELAY_OTLP_TRACES_TOKEN", "token");

  expect(resolveRelayTracingConfig()).toBeNull();
});
