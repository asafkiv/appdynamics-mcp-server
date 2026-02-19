/**
 * Tool: appd_get_health_rules
 * List health rules configured for an application.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGet } from "../services/api-client.js";
import { resolveAppId } from "../utils/app-resolver.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { truncateIfNeeded } from "../utils/formatting.js";
import type { HealthRule } from "../types.js";

const InputSchema = {
  application: z
    .union([z.string(), z.number()])
    .describe("Application name or numeric ID."),
  healthRuleId: z
    .number()
    .int()
    .optional()
    .describe("Optional: specific health rule ID to get detailed info."),
};

export function registerHealthRuleTools(server: McpServer): void {
  server.registerTool(
    "appd_get_health_rules",
    {
      title: "List Health Rules",
      description: `List health rules configured for an application, or get details of a specific health rule.

Health rules define the thresholds and conditions that trigger violations. Understanding what health rules exist and their configuration is essential context for interpreting violations.

Without healthRuleId: returns a summary list of all health rules (id, name, type, enabled, affected entity type).
With healthRuleId: returns the full configuration of that specific health rule including evaluation criteria.

Args:
  - application (string|number): App name or ID
  - healthRuleId (number, optional): Specific health rule ID for details

Returns: Array of health rules or single detailed health rule object.`,
      inputSchema: InputSchema,
      annotations: { 
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ application, healthRuleId }) => {
      try {
        const appId = await resolveAppId(application);

        if (healthRuleId !== undefined) {
          const rule = await appdGet<HealthRule>(
            `/controller/rest/applications/${appId}/health-rules/${healthRuleId}`
          );
          return textResponse(JSON.stringify(rule, null, 2));
        }

        const rules = await appdGet<HealthRule[]>(
          `/controller/rest/applications/${appId}/health-rules`
        );

        const summary = rules.map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          enabled: r.enabled,
          isDefault: r.isDefault,
          affectedEntityType: r.affectedEntityType,
        }));

        return textResponse(truncateIfNeeded(summary));
      } catch (error) {
        return handleError(error);
      }
    }
  );  
}