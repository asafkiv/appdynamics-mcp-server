/**
 * Tool: appd_get_bt_performance
 * Get performance metrics for a specific business transaction.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGet } from "../services/api-client.js";
import { resolveAppId } from "../utils/app-resolver.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { DEFAULT_DURATION_MINS, BT_METRICS } from "../constants.js";
import type { BusinessTransaction, MetricData } from "../types.js";

const InputSchema = {
  application: z
    .union([z.string(), z.number()])
    .describe("Application name or numeric ID."),
  btId: z.number().int().describe("The numeric ID of the business transaction."),
  durationInMins: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Time range in minutes to look back. Defaults to 60."),
};

export function registerBtPerformanceTools(server: McpServer): void {
  server.registerTool(
    "appd_get_bt_performance",
    {
      title: "Get BT Performance Metrics",
      description: `Get performance metrics for a specific business transaction (BT).

Retrieves average response time, calls per minute, errors per minute, slow calls, very slow calls, and stall count for the specified BT.

Use appd_get_business_transactions first to find the BT ID.

Args:
  - application (string|number): App name or ID
  - btId (number): Business transaction ID
  - durationInMins (number, optional): Lookback in minutes (default: 60)

Returns: BT details plus metric data for each performance metric.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ application, btId, durationInMins }) => {
      try {
        const appId = await resolveAppId(application);
        const duration = durationInMins ?? DEFAULT_DURATION_MINS;

        // Get BT details to build metric paths
        const bts = await appdGet<BusinessTransaction[]>(
          `/controller/rest/applications/${appId}/business-transactions`
        );

        const bt = bts.find((b) => b.id === btId);
        if (!bt) {
          return {
            content: [
              {
                type: "text",
                text: `Business transaction with ID ${btId} not found. Use appd_get_business_transactions to list available BTs.`,
              },
            ],
            isError: true,
          };
        }

        // Fetch all BT metrics in parallel
        const metricPromises = BT_METRICS.map((metric) =>
          appdGet<MetricData[]>(
            `/controller/rest/applications/${appId}/metric-data`,
            {
              "metric-path": `Business Transaction Performance|Business Transactions|${bt.tierName}|${bt.name}|${metric}`,
              "time-range-type": "BEFORE_NOW",
              "duration-in-mins": duration,
            }
          )
            .then((data) => ({ metric, data: data[0] ?? null }))
            .catch(() => ({ metric, data: null }))
        );

        const metricResults = await Promise.all(metricPromises);

        const results: Record<string, unknown> = {
          businessTransaction: {
            id: bt.id,
            name: bt.name,
            tierName: bt.tierName,
            entryPointType: bt.entryPointType,
          },
          timeRange: `Last ${duration} minutes`,
        };

        for (const result of metricResults) {
          if (result.data) {
            results[result.metric] = result.data;
          }
        }

        return textResponse(JSON.stringify(results, null, 2));
      } catch (error) {
        return handleError(error);
      }
    }
  );
}
