// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { codexMcpCwdOverrides } from "./codexMcpConfig.ts";

describe("codexMcpCwdOverrides", () => {
  it.each([NodePath.resolve("/work/checkouts/one"), NodePath.resolve("/work/worktrees/two")])(
    "resolves each field's source independently in %s",
    (cwd) => {
      const userConfigDir = NodePath.resolve("/home/example/.codex");
      const response: CodexSchema.V2ConfigReadResponse = {
        config: {
          model: "unchanged",
          mcp_servers: {
            missing: { command: "./scripts/mcp", args: ["mcp"], env: { TOKEN: "keep" } },
            project: { command: "./scripts/mcp", cwd: ".." },
            nested: { command: "node", cwd: "../tools" },
            user: { command: "node", cwd: "tools" },
            flags: { command: "node", cwd: "tools" },
            "server.with.dots": { command: "./scripts/mcp" },
          },
        },
        origins: {
          "mcp_servers.project.cwd": {
            name: { type: "project", dotCodexFolder: NodePath.join(cwd, ".codex") },
            version: "project",
          },
          "mcp_servers.nested.cwd": {
            name: { type: "project", dotCodexFolder: NodePath.join(cwd, "nested", ".codex") },
            version: "nested",
          },
          // A project can override a command while inheriting a user's cwd.
          "mcp_servers.user.command": {
            name: { type: "project", dotCodexFolder: NodePath.join(cwd, ".codex") },
            version: "project",
          },
          "mcp_servers.user.cwd": {
            name: { type: "user", file: NodePath.join(userConfigDir, "config.toml") },
            version: "user",
          },
          "mcp_servers.flags.cwd": { name: { type: "sessionFlags" }, version: "flags" },
        },
      };
      const before = structuredClone(response);

      expect(codexMcpCwdOverrides(response, cwd)).toEqual({
        missing: { cwd },
        project: { cwd },
        nested: { cwd: NodePath.join(cwd, "nested", "tools") },
        user: { cwd: NodePath.join(userConfigDir, "tools") },
        flags: { cwd: NodePath.join(cwd, "tools") },
        "server.with.dots": { cwd },
      });
      expect(response).toEqual(before);
    },
  );

  it("leaves absolute, disabled, HTTP, remote and malformed servers alone", () => {
    const response: CodexSchema.V2ConfigReadResponse = {
      config: {
        mcp_servers: {
          absolute: { command: "./mcp", cwd: "/other/checkout" },
          disabled: { command: "./mcp", cwd: "..", enabled: false },
          http: { url: "https://example.com/mcp", bearer_token_env_var: "TOKEN" },
          remote: { command: "./mcp", environment_id: "remote-host" },
          experimentalRemote: { command: "./mcp", experimental_environment: "remote" },
          malformed: { command: "./mcp", cwd: 123 },
          empty: { command: "" },
          null: null,
        },
      },
      origins: {},
    };
    expect(codexMcpCwdOverrides(response, "/work/checkout")).toEqual({});
  });

  it.each([undefined, null, [], "invalid"])("handles absent or invalid maps: %s", (servers) => {
    expect(
      codexMcpCwdOverrides({ config: { mcp_servers: servers }, origins: {} }, "/work/checkout"),
    ).toEqual({});
  });
});
