/**
 * Tool: appd_get_applications
 * List all business applications in AppDynamics.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGet } from "../services/api-client.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { truncateIfNeeded } from "../utils/formatting.js";
import type { AppDApplication } from "../types.js";

const InputSchema = {
  nameFilter: z
    .string()
    .optional()
    .describe(
      "Optional: filter applications by name (case-insensitive partial match)"
    ),
};

export function registerApplicationTools(server: McpServer): void {
  server.registerTool(
    "appd_get_applications",
    {
      title: "List AppDynamics Applications",
      description: `List all business applications monitored by AppDynamics.

Optionally filter by name using a case-insensitive partial match.
Returns application ID, name, and description for each app.

Use this tool first to discover application IDs needed by other tools.

Args:
  - nameFilter (string, optional): Filter by application name

Returns: Array of applications with id, name, and description.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ nameFilter }) => {
      try {
        let apps = await appdGet<AppDApplication[]>(
          "/controller/rest/applications"
        );

        if (nameFilter) {
          const filter = nameFilter.toLowerCase();
          apps = apps.filter((a) =>
            a.name.toLowerCase().includes(filter)
          );
        }

        const summary = apps.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description ?? "",
        }));

        return textResponse(truncateIfNeeded(summary));
      } catch (error) {
        return handleError(error);
      }
    }
  );
}
