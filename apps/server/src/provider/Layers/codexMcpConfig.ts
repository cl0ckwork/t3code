// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import type * as CodexSchema from "effect-codex-app-server/schema";

const isMcpServers = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
const isStdioServer = Schema.is(
  Schema.Struct({
    command: Schema.String,
    cwd: Schema.optionalKey(Schema.NullOr(Schema.String)),
    enabled: Schema.optionalKey(Schema.Boolean),
    environment_id: Schema.optionalKey(Schema.String),
    experimental_environment: Schema.optionalKey(Schema.String),
  }),
);

/** Resolve stdio launch directories without rewriting commands or other MCP settings. */
export function codexMcpCwdOverrides(
  response: CodexSchema.V2ConfigReadResponse,
  threadCwd: string,
): Record<string, { cwd: string }> {
  const servers = response.config.mcp_servers;
  if (!isMcpServers(servers)) return {};

  return Object.fromEntries(
    Object.entries(servers).flatMap(([name, server]) => {
      if (
        !isStdioServer(server) ||
        server.enabled === false ||
        server.command.length === 0 ||
        (server.environment_id !== undefined && server.environment_id !== "local") ||
        server.experimental_environment === "remote" ||
        (server.cwd != null && NodePath.isAbsolute(server.cwd))
      ) {
        return [];
      }

      // config/read retains relative MCP cwd values and identifies the layer
      // that supplied each field. Project paths are relative to .codex/, not
      // the app-server's launch directory; a missing cwd uses the thread root.
      const source = response.origins[`mcp_servers.${name}.cwd`]?.name;
      const base =
        source?.type === "project"
          ? source.dotCodexFolder
          : source && "file" in source
            ? NodePath.dirname(source.file)
            : threadCwd;
      const cwd = server.cwd == null ? threadCwd : NodePath.resolve(base, server.cwd);
      return [[name, { cwd }]];
    }),
  );
}
