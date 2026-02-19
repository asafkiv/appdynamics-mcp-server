/**
 * Tools: appd_get_metric_data, appd_browse_metric_tree
 * Generic metric querying and metric tree browsing.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGet } from "../services/api-client.js";
import { resolveAppId } from "../utils/app-resolver.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { truncateIfNeeded } from "../utils/formatting.js";
import { DEFAULT_DURATION_MINS } from "../constants.js";

// ── Get Metric Data ────────────────────────────────────────────────────────

const MetricDataSchema = {
  application: z
    .union([z.string(), z.number()])
    .describe("Application name or numeric ID."),
  metricPath: z
    .string()
    .describe(
      "The metric path to query. Use appd_browse_metric_tree to discover available paths. Examples: 'Overall Application Performance|Average Response Time (ms)', 'Application Infrastructure Performance|*|Hardware Resources|CPU|%Busy'."
    ),
  durationInMins: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Time range in minutes to look back. Defaults to 60."),
};

// ── Browse Metric Tree ───────────────────────────────────────────────────────

const BrowseMetricTreeSchema = {
  application: z
    .union([z.string(), z.number()])
    .describe("Application name or numeric ID."),
  metricPath: z
    .string()
    .optional()
    .describe(
      "Parent metric path to browse. Omit to see the top-level folders. Use pipe-separated paths like 'Overall Application Performance' or 'Application Infrastructure Performance|Tier1'."
    ),
};

export function registerMetricTools(server: McpServer): void {
  // ── appd_get_metric_data ─────────────────────────────────────────────────

  server.registerTool(
    "appd_get_metric_data",
    {
      title: "Get Metric Data",
      description: `Query any metric from the AppDynamics metric tree.

This is a generic tool that can retrieve any metric — infrastructure (CPU, memory, disk), application performance, custom metrics, etc.

Use appd_browse_metric_tree to discover available metric paths first.

Args:
  - application (string|number): App name or ID
  - metricPath (string): Full metric path (pipe-separated)
  - durationInMins (number, optional): Lookback in minutes (default: 60)

Returns: Array of metric data objects with timestamps, min, max, avg, count, sum values.`,
      inputSchema: MetricDataSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ application, metricPath, durationInMins }) => {
      try {
        const appId = await resolveAppId(application);
        const duration = durationInMins ?? DEFAULT_DURATION_MINS;

        const data = await appdGet(
          `/controller/rest/applications/${appId}/metric-data`,
          {
            "metric-path": metricPath,
            "time-range-type": "BEFORE_NOW",
            "duration-in-mins": duration,
          }
        );

        return textResponse(truncateIfNeeded(data));
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── appd_browse_metric_tree ──────────────────────────────────────────────

  server.registerTool(
    "appd_browse_metric_tree",
    {
      title: "Browse Metric Tree",
      description: `Browse the AppDynamics metric tree to discover available metric paths.

Call without metricPath to see top-level folders, then drill into specific folders by providing their path.

Common top-level folders:
  - Overall Application Performance
  - Application Infrastructure Performance
  - Business Transaction Performance
  - Backends
  - Errors
  - Service Endpoints

Args:
  - application (string|number): App name or ID
  - metricPath (string, optional): Parent path to browse (omit for top-level)

Returns: Array of child metric nodes with name, type (folder or leaf), and full path.`,
      inputSchema: BrowseMetricTreeSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ application, metricPath }) => {
      try {
        const appId = await resolveAppId(application);

        const params: Record<string, string | number | boolean | undefined> = {};
        if (metricPath) {
          params["metric-path"] = metricPath;
        }

        const data = await appdGet(
          `/controller/rest/applications/${appId}/metrics`,
          params
        );

        return textResponse(truncateIfNeeded(data));
      } catch (error) {
        return handleError(error);
      }
    }
  );
}
