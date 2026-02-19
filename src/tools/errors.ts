/**
 * Tool: appd_get_errors
 * Retrieve error and exception events for an application.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGet } from "../services/api-client.js";
import { resolveAppId } from "../utils/app-resolver.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { truncateIfNeeded } from "../utils/formatting.js";
import {
  DEFAULT_DURATION_MINS,
  ERROR_EVENT_TYPES,
  ERROR_SEVERITIES,
} from "../constants.js";

const InputSchema = {
  application: z
    .union([z.string(), z.number()])
    .describe("Application name or numeric ID."),
  durationInMins: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Time range in minutes to look back. Defaults to 60."),
};

export function registerErrorTools(server: McpServer): void {
  server.registerTool(
    "appd_get_errors",
    {
      title: "Get Error Events",
      description: `Retrieve error and exception events for an application.

Returns ERROR, APPLICATION_ERROR, and APPLICATION_CRASH events from the AppDynamics events API. These represent exceptions, application errors, and crashes detected by the agent.

Args:
  - application (string|number): App name or ID
  - durationInMins (number, optional): Lookback in minutes (default: 60)

Returns: Array of error events with severity, summary, timestamp, and affected entity details.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ application, durationInMins }) => {
      try {
        const appId = await resolveAppId(application);
        const duration = durationInMins ?? DEFAULT_DURATION_MINS;

        const data = await appdGet(
          `/controller/rest/applications/${appId}/events`,
          {
            "time-range-type": "BEFORE_NOW",
            "duration-in-mins": duration,
            "event-types": ERROR_EVENT_TYPES,
            severities: ERROR_SEVERITIES,
          }
        );

        return textResponse(truncateIfNeeded(data));
      } catch (error) {
        return handleError(error);
      }
    }
  );
}
