/**
 * Tool: appd_get_tiers_and_nodes
 * Get infrastructure topology (tiers and nodes) for an application.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGet } from "../services/api-client.js";
import { resolveAppId } from "../utils/app-resolver.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { truncateIfNeeded } from "../utils/formatting.js";
import type { Tier, AppDNode } from "../types.js";

const InputSchema = {
  application: z
    .union([z.string(), z.number()])
    .describe("Application name or numeric ID."),
};

export function registerTiersNodesTools(server: McpServer): void {
  server.registerTool(
    "appd_get_tiers_and_nodes",
    {
      title: "Get Tiers and Nodes",
      description: `Retrieve the tiers and nodes (infrastructure topology) for an application.

Shows each tier with its type, agent type, and associated nodes. Nodes include machine details, agent versions, and IP addresses.

Args:
  - application (string|number): App name or ID

Returns: Array of tiers, each with a nested array of nodes.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ application }) => {
      try {
        const appId = await resolveAppId(application);

        // Fetch tiers and nodes in parallel
        const [tiers, nodes] = await Promise.all([
          appdGet<Tier[]>(
            `/controller/rest/applications/${appId}/tiers`
          ),
          appdGet<AppDNode[]>(
            `/controller/rest/applications/${appId}/nodes`
          ),
        ]);

        // Group nodes by tier
        const nodesByTier = new Map<number, AppDNode[]>();
        for (const node of nodes) {
          const existing = nodesByTier.get(node.tierId) ?? [];
          existing.push(node);
          nodesByTier.set(node.tierId, existing);
        }

        const result = tiers.map((tier) => ({
          ...tier,
          nodes: nodesByTier.get(tier.id) ?? [],
        }));

        return textResponse(truncateIfNeeded(result));
      } catch (error) {
        return handleError(error);
      }
    }
  );
}
