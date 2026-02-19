/**
 * Tool: appd_get_backends
 * List backend (remote service) dependencies for an application.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGet } from "../services/api-client.js";
import { resolveAppId } from "../utils/app-resolver.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { truncateIfNeeded } from "../utils/formatting.js";
import type { Backend } from "../types.js";

const InputSchema = {
  application: z
    .union([z.string(), z.number()])
    .describe("Application name or numeric ID."),
  typeFilter: z
    .string()
    .optional()
    .describe(
      "Optional: filter backends by exit point type (e.g., 'HTTP', 'JDBC', 'CACHE', 'JMS'). Case-insensitive."
    ),
};

export function registerBackendTools(server: McpServer): void {
  server.registerTool(
    "appd_get_backends",
    {
      title: "Get Backends / Remote Services",
      description: `List all backend (remote service) dependencies detected for an application.

Backends are external services your application calls — databases (JDBC), HTTP APIs, caches (Redis, Memcached), message queues (JMS, Kafka), etc.

This is one of AppDynamics' most powerful features for dependency mapping and troubleshooting. Slow backends are a common root cause of application performance issues.

Args:
  - application (string|number): App name or ID
  - typeFilter (string, optional): Filter by exit point type (e.g., "HTTP", "JDBC", "CACHE")

Returns: Array of backends with id, name, exitPointType, and connection properties.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ application, typeFilter }) => {
      try {
        const appId = await resolveAppId(application);
        let backends = await appdGet<Backend[]>(
          `/controller/rest/applications/${appId}/backends`
        );

        if (typeFilter) {
          const filter = typeFilter.toUpperCase();
          backends = backends.filter((b) =>
            b.exitPointType.toUpperCase().includes(filter)
          );
        }

        const summary = backends.map((b) => ({
          id: b.id,
          name: b.name,
          exitPointType: b.exitPointType,
          properties: b.properties?.map((p) => ({
            name: p.name,
            value: p.value,
          })),
        }));

        return textResponse(truncateIfNeeded(summary));
      } catch (error) {
        return handleError(error);
      }
    }
  );
}
