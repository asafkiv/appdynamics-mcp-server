/**
 * Tool: appd_get_business_transactions
 * List business transactions for an application.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGet } from "../services/api-client.js";
import { resolveAppId } from "../utils/app-resolver.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { truncateIfNeeded } from "../utils/formatting.js";
import type { BusinessTransaction } from "../types.js";

const InputSchema = {
  application: z
    .union([z.string(), z.number()])
    .describe("Application name or numeric ID."),
  tierFilter: z
    .string()
    .optional()
    .describe("Optional: filter BTs by tier name (case-insensitive partial match)."),
};

export function registerBusinessTransactionTools(server: McpServer): void {
  server.registerTool(
    "appd_get_business_transactions",
    {
      title: "List Business Transactions",
      description: `List all business transactions (BTs) for a given application.

BTs are the key unit of monitoring in AppDynamics — each represents a distinct user request or workflow. Use this to discover BT IDs neeed by appd_get_bt_performance.

Args:
  - application (string|number): App name or IF
  - tierFilter (string, optional): Filter by tier name

Returns: Array of BTs with id, name, tierName, entryPointType.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ application, tierFilter }) => {
      try {
        const appId = await resolveAppId(application);
        let bts = await appdGet<BusinessTransaction[]>(
          `/controller/rest/applications/${appId}/business-transactions`
        );

        if (tierFilter) {
          const filter = tierFilter.toLowerCase();
          bts = bts.filter((bt) =>
            bt.tierName.toLowerCase().includes(filter)
          );
        }

        const summary = bts.map((bt) => ({
          id: bt.id,
          name: bt.name,
          tierName: bt.tierName,
          entryPointType: bt.entryPointType,
          background: bt.background ?? false,
        }));

        return textResponse(truncateIfNeeded(summary));
      } catch (error) {
        return handleError(error);
      }
    }
  );
}
