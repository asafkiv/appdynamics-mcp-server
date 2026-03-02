/**
 * Dashboard tools: list, get, create, update, clone, delete, export.
 * Full CRUD for AppDynamics custom dashboards.
 *
 * Widget format matches the AppDynamics restui API:
 *   - Types: TIMESERIES_GRAPH, METRIC_VALUE, HEALTH_LIST, TEXT, PIE, GAUGE, ANALYTICS
 *   - Metrics use widgetsMetricMatchCriterias[] (not dataSeriesTemplateMap)
 *   - Colors are integers (e.g. 16777215 = white), not hex strings
 *   - Canvas type: CANVAS_TYPE_GRID with grid-unit positioning
 */

import { writeFile } from "fs/promises";
import { resolve } from "path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGet, appdGetRaw, appdPost } from "../services/api-client.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { truncateIfNeeded } from "../utils/formatting.js";
import type { BusinessTransaction, Dashboard, DashboardSummary, HealthRule, Tier } from "../types.js";
import { resolveAppId } from "../utils/app-resolver.js";

// ── Color Helpers ─────────────────────────────────────────────────────────────

/** Convert hex color string (#RRGGBB) to integer, or pass through if already a number. */
function colorToInt(color: string | number | undefined, fallback: number): number {
  if (color === undefined) return fallback;
  if (typeof color === "number") return color;
  const hex = color.replace(/^#/, "");
  const parsed = parseInt(hex, 16);
  return isNaN(parsed) ? fallback : parsed;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COLOR_WHITE = 16777215; // #FFFFFF
const COLOR_LIGHT_GRAY = 15856629; // #F1F1F5
const COLOR_DARK = 1646891; // #19222B
const COLOR_BORDER = 14408667; // #DBDBDB

// ── Schemas ───────────────────────────────────────────────────────────────────

const ListSchema = {
  nameFilter: z
    .string()
    .optional()
    .describe("Optional: filter dashboards by name (case-insensitive partial match)."),
};

const GetSchema = {
  dashboardId: z.number().int().describe("The numeric ID of the dashboard."),
};

const DeleteSchema = {
  dashboardId: z.number().int().describe("The numeric ID of the dashboard to delete."),
};

const ExportSchema = {
  dashboardId: z.number().int().describe("The numeric ID of the dashboard to export."),
};

const CloneSchema = {
  dashboardId: z.number().int().describe("The ID of the source dashboard to clone."),
  newName: z.string().min(1).describe("Name for the cloned dashboard."),
};

const WidgetSchema = z.object({
  type: z
    .string()
    .describe(
      "Widget type. Use: 'TIMESERIES_GRAPH' (time-series chart), 'METRIC_VALUE' (single number), 'HEALTH_LIST' (health status), 'TEXT' (text/title), 'PIE' (pie chart), 'GAUGE' (gauge)."
    ),
  title: z.string().describe("Widget title displayed on the dashboard."),
  height: z.number().int().min(1).describe("Widget height in grid units (typical: 2-4)."),
  width: z.number().int().min(1).describe("Widget width in grid units (max 12 for full row)."),
  x: z.number().int().min(0).describe("X position in grid units (0-11)."),
  y: z.number().int().min(0).describe("Y position in grid units."),
  applicationId: z
    .number()
    .int()
    .optional()
    .describe("Application ID to source metrics from."),
  metricPath: z
    .string()
    .optional()
    .describe(
      "Metric path for metric-based widgets. Use appd_browse_metric_tree to find paths."
    ),
  entityType: z
    .string()
    .optional()
    .describe("Entity type: 'APPLICATION', 'APPLICATION_COMPONENT' (tier), 'APPLICATION_COMPONENT_NODE' (node), 'POLICY' (health rules)."),
  text: z
    .string()
    .optional()
    .describe("Text content for TEXT widget type."),
  description: z.string().optional().describe("Widget description."),
  applicationName: z
    .string()
    .optional()
    .describe("Application name (required for export-format files to embed correct metric paths)."),
  adqlQuery: z
    .string()
    .optional()
    .describe("ADQL query string for ANALYTICS widget type."),
});

const CreateSchema = {
  name: z.string().min(1).describe("Dashboard name."),
  description: z.string().optional().describe("Dashboard description."),
  height: z
    .number()
    .int()
    .min(100)
    .optional()
    .describe("Dashboard canvas height in pixels. Default: 768."),
  width: z
    .number()
    .int()
    .min(100)
    .optional()
    .describe("Dashboard canvas width in pixels. Default: 1024."),
  widgets: z
    .array(WidgetSchema)
    .optional()
    .describe("Array of widgets to place on the dashboard. Can be empty to create a blank dashboard, then add widgets later with appd_add_widget_to_dashboard."),
  template: z
    .boolean()
    .optional()
    .describe("If true, create as a template dashboard."),
};

const UpdateSchema = {
  dashboardId: z.number().int().describe("The ID of the dashboard to update."),
  name: z.string().optional().describe("New dashboard name."),
  description: z.string().optional().describe("New dashboard description."),
  height: z.number().int().min(100).optional().describe("New canvas height."),
  width: z.number().int().min(100).optional().describe("New canvas width."),
  widgets: z
    .array(WidgetSchema)
    .optional()
    .describe("Complete set of widgets. NOTE: This replaces ALL existing widgets."),
};

const AddWidgetSchema = {
  dashboardId: z.number().int().describe("The ID of the dashboard to add a widget to."),
  widget: WidgetSchema.describe("The widget to add to the dashboard."),
};

// ── Registration ──────────────────────────────────────────────────────────────

export function registerDashboardTools(server: McpServer): void {
  // ── List Dashboards ─────────────────────────────────────────────────────────

  server.registerTool(
    "appd_get_dashboards",
    {
      title: "List Dashboards",
      description: `List all custom dashboards in AppDynamics.

Returns dashboard summaries including id, name, creator, and timestamps.
Use nameFilter to search for specific dashboards.

Args:
  - nameFilter (string, optional): Filter by dashboard name

Returns: Array of dashboard summaries.`,
      inputSchema: ListSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ nameFilter }) => {
      try {
        const dashboards = await appdGetRaw<DashboardSummary[]>(
          "/controller/restui/dashboards/getAllDashboardsByType/false"
        );

        let filtered = Array.isArray(dashboards) ? dashboards : [];

        if (nameFilter) {
          const search = nameFilter.toLowerCase();
          filtered = filtered.filter((d) =>
            d.name.toLowerCase().includes(search)
          );
        }

        const summary = filtered.map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description ?? "",
          createdBy: d.createdBy ?? "",
          modifiedOn: d.modifiedOn,
        }));

        return textResponse(truncateIfNeeded(summary));
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── Get Dashboard Details ───────────────────────────────────────────────────

  server.registerTool(
    "appd_get_dashboard",
    {
      title: "Get Dashboard Details",
      description: `Get the full definition of a specific dashboard, including all widgets and their configurations.

This reveals what metrics and entities the dashboard monitors — useful for understanding what a team cares about, or for cloning/modifying dashboards.

Args:
  - dashboardId (number): Dashboard ID (from appd_get_dashboards)

Returns: Complete dashboard object with widgets, layout, and data source configuration.`,
      inputSchema: GetSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ dashboardId }) => {
      try {
        const dashboard = await appdGetRaw<Dashboard>(
          `/controller/restui/dashboards/dashboardIfUpdated/${dashboardId}/-1`
        );
        return textResponse(truncateIfNeeded(dashboard));
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── Create Dashboard ────────────────────────────────────────────────────────

  server.registerTool(
    "appd_create_dashboard",
    {
      title: "Create Dashboard",
      description: `Create a new custom dashboard in AppDynamics.

You can create a blank dashboard and add widgets later using appd_add_widget_to_dashboard, or provide widgets upfront.

Widget types (use exact names):
  - "TIMESERIES_GRAPH": Time-series line/area chart (needs applicationId + metricPath)
  - "METRIC_VALUE": Single metric number display (needs applicationId + metricPath)
  - "HEALTH_LIST": Health rule status list (needs applicationId, entityType like 'POLICY')
  - "TEXT": Static text label or title (needs text)
  - "PIE": Pie chart (needs applicationId + metricPath)
  - "GAUGE": Gauge display (needs applicationId + metricPath)

Grid layout: width max is 12 (full row). Height is in grid units (2-4 typical).
Use appd_browse_metric_tree to discover metric paths for widgets.

Args:
  - name (string): Dashboard name
  - description (string, optional): Description
  - height/width (number, optional): Canvas size (default: 768x1024)
  - widgets (array, optional): Widgets to place on the dashboard
  - template (boolean, optional): Create as template

Returns: The created dashboard object with its new ID.`,
      inputSchema: CreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, description, height, width, widgets, template }) => {
      try {
        const dashboardPayload = {
          name,
          description: description ?? null,
          height: height ?? 768,
          width: width ?? 1024,
          canvasType: "CANVAS_TYPE_GRID",
          templateEntityType: "APPLICATION_COMPONENT_NODE",
          minimized: false,
          color: COLOR_LIGHT_GRAY,
          backgroundColor: COLOR_LIGHT_GRAY,
          template: template ?? false,
          warRoom: false,
          disabled: false,
          refreshInterval: 120000,
          minutesBeforeAnchorTime: -1,
          startTime: -1,
          endTime: -1,
          layoutType: "",
          properties: [],
          widgets: (widgets ?? []).map((w, i) => buildWidgetPayload(w, i)),
        };

        const created = await appdPost<Dashboard>(
          "/controller/restui/dashboards/createDashboard",
          dashboardPayload
        );

        return textResponse(JSON.stringify(created, null, 2));
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── Update Dashboard ────────────────────────────────────────────────────────

  server.registerTool(
    "appd_update_dashboard",
    {
      title: "Update Dashboard",
      description: `Update an existing dashboard's properties and/or widgets.

IMPORTANT: If you provide widgets, this REPLACES all existing widgets. To add a single widget without losing existing ones, use appd_add_widget_to_dashboard instead.

Args:
  - dashboardId (number): Dashboard ID
  - name (string, optional): New name
  - description (string, optional): New description
  - height/width (number, optional): New canvas size
  - widgets (array, optional): Complete widget set (replaces existing)

Returns: The updated dashboard object.`,
      inputSchema: UpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ dashboardId, name, description, height, width, widgets }) => {
      try {
        const existing = await appdGetRaw<Dashboard>(
          `/controller/restui/dashboards/dashboardIfUpdated/${dashboardId}/-1`
        );

        const updated = {
          ...existing,
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(height !== undefined && { height }),
          ...(width !== undefined && { width }),
          ...(widgets !== undefined && {
            widgets: widgets.map((w, i) => buildWidgetPayload(w, i)),
          }),
        };

        const result = await appdPost<Dashboard>(
          "/controller/restui/dashboards/updateDashboard",
          updated
        );

        return textResponse(JSON.stringify(result, null, 2));
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── Add Widget to Dashboard ─────────────────────────────────────────────────

  server.registerTool(
    "appd_add_widget_to_dashboard",
    {
      title: "Add Widget to Dashboard",
      description: `Add a single widget to an existing dashboard without replacing existing widgets.

This fetches the current dashboard, appends the new widget, and saves it.

Widget types (use exact names):
  - "TIMESERIES_GRAPH": Time-series chart (needs applicationId + metricPath)
  - "METRIC_VALUE": Single metric number (needs applicationId + metricPath)
  - "HEALTH_LIST": Health status list (needs applicationId + entityType)
  - "TEXT": Static text label (needs text)

Args:
  - dashboardId (number): Dashboard ID
  - widget: Widget object with type, title, height, width, x, y, and type-specific fields

Returns: The updated dashboard with the new widget added.`,
      inputSchema: AddWidgetSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ dashboardId, widget }) => {
      try {
        const existing = await appdGetRaw<Dashboard>(
          `/controller/restui/dashboards/dashboardIfUpdated/${dashboardId}/-1`
        );

        const existingWidgets = existing.widgets ?? [];
        const newWidgetIndex = existingWidgets.length;

        const updated = {
          ...existing,
          widgets: [
            ...existingWidgets,
            buildWidgetPayload(widget, newWidgetIndex),
          ],
        };

        const result = await appdPost<Dashboard>(
          "/controller/restui/dashboards/updateDashboard",
          updated
        );

        return textResponse(JSON.stringify(result, null, 2));
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── Clone Dashboard ─────────────────────────────────────────────────────────

  server.registerTool(
    "appd_clone_dashboard",
    {
      title: "Clone Dashboard",
      description: `Clone an existing dashboard with a new name.

Creates an exact copy of the source dashboard (including all widgets) with the specified new name.

Args:
  - dashboardId (number): Source dashboard ID to clone
  - newName (string): Name for the cloned dashboard

Returns: The newly created dashboard with its new ID.`,
      inputSchema: CloneSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ dashboardId, newName }) => {
      try {
        const source = await appdGetRaw<Dashboard>(
          `/controller/restui/dashboards/dashboardIfUpdated/${dashboardId}/-1`
        );

        const { id: _id, ...cloneData } = source;
        const clonePayload = { ...cloneData, name: newName };

        const created = await appdPost<Dashboard>(
          "/controller/restui/dashboards/createDashboard",
          clonePayload
        );

        return textResponse(JSON.stringify(created, null, 2));
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── Delete Dashboard ────────────────────────────────────────────────────────

  server.registerTool(
    "appd_delete_dashboard",
    {
      title: "Delete Dashboard",
      description: `Delete a custom dashboard. This action is PERMANENT and cannot be undone.

Consider using appd_export_dashboard first to create a backup.

Args:
  - dashboardId (number): Dashboard ID to delete

Returns: Confirmation of deletion.`,
      inputSchema: DeleteSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ dashboardId }) => {
      try {
        await appdPost(
          `/controller/restui/dashboards/deleteDashboards`,
          [dashboardId]
        );
        return textResponse(
          `Dashboard ${dashboardId} deleted successfully.`
        );
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── Auto-Build Dashboard ────────────────────────────────────────────────────

  server.registerTool(
    "appd_auto_build_dashboard",
    {
      title: "Auto-Build Dashboard",
      description: `Automatically build a complete monitoring dashboard for an application.

Discovers the application's tiers, business transactions, and health rules, then creates a fully populated multi-section dashboard in AppDynamics.

Focus modes:
  - "comprehensive" (default): Overview + business transactions + infrastructure + health
  - "performance": Overview + business transactions
  - "infrastructure": Overview + tier-level graphs
  - "health": Overview + health status

Args:
  - applicationName (string): Application name or numeric ID
  - dashboardName (string, optional): Dashboard name. Defaults to "{AppName} - Auto Dashboard"
  - focus (string, optional): comprehensive | performance | infrastructure | health
  - timeRangeMinutes (number, optional): Time window in minutes. Default: 60

Returns: The created dashboard name and ID.`,
      inputSchema: {
        applicationName: z.string().describe("Application name or numeric ID."),
        dashboardName: z
          .string()
          .optional()
          .describe('Dashboard name. Defaults to "{AppName} - Auto Dashboard".'),
        focus: z
          .enum(["comprehensive", "performance", "infrastructure", "health"])
          .optional()
          .describe(
            'Dashboard focus: "comprehensive" (default), "performance", "infrastructure", or "health".'
          ),
        timeRangeMinutes: z
          .number()
          .int()
          .min(5)
          .optional()
          .describe("Time window in minutes for metric graphs. Default: 60."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ applicationName, dashboardName, focus = "comprehensive", timeRangeMinutes = 60 }) => {
      try {
        const appId = await resolveAppId(applicationName);
        const appName = applicationName;

        const needsBTs = focus === "comprehensive" || focus === "performance";
        const needsTiers = focus === "comprehensive" || focus === "infrastructure";
        const needsHealth = focus === "comprehensive" || focus === "health";

        // Parallel data fetch — only request what the focus mode needs
        const [tiers, bts, healthRules] = await Promise.all([
          needsTiers
            ? appdGet<Tier[]>(`/controller/rest/applications/${appId}/tiers`)
            : Promise.resolve([] as Tier[]),
          needsBTs
            ? appdGet<BusinessTransaction[]>(
                `/controller/rest/applications/${appId}/business-transactions`
              )
            : Promise.resolve([] as BusinessTransaction[]),
          needsHealth
            ? appdGet<HealthRule[]>(
                `/controller/rest/applications/${appId}/policy/health-rules`
              )
            : Promise.resolve([] as HealthRule[]),
        ]);

        const topTiers = tiers.slice(0, 3);
        const topBTs = bts.slice(0, 5);
        const dashName = dashboardName ?? `${appName} - Auto Dashboard`;

        // ── Compose widget list ──────────────────────────────────────────────
        const widgets: WidgetInput[] = [];
        let y = 0;

        function push(w: WidgetInput): void {
          widgets.push(w);
        }

        // ── Section: App Overview — title banner ─────────────────────────────
        push({
          type: "TEXT",
          title: "Dashboard Title",
          text: `── ${appName} Performance Dashboard ──`,
          width: 12,
          height: 1,
          x: 0,
          y,
        });
        y += 1;

        // ── Section: App Overview — time-series graphs (3 columns) ───────────
        const overviewGraphs = [
          {
            title: "Response Time (ms)",
            metric: "Overall Application Performance|Average Response Time (ms)",
          },
          {
            title: "Errors per Minute",
            metric: "Overall Application Performance|Errors per Minute",
          },
          {
            title: "Calls per Minute",
            metric: "Overall Application Performance|Calls per Minute",
          },
        ];
        overviewGraphs.forEach((g, i) => {
          push({
            type: "TIMESERIES_GRAPH",
            title: g.title,
            metricPath: g.metric,
            applicationId: appId,
            width: 4,
            height: 3,
            x: i * 4,
            y,
          });
        });
        y += 3;

        // ── Section: App Overview — metric value tiles ───────────────────────
        const metricValues = [
          {
            title: "Avg Response Time",
            metric: "Overall Application Performance|Average Response Time (ms)",
          },
          {
            title: "Error Rate",
            metric: "Overall Application Performance|Errors per Minute",
          },
          {
            title: "Throughput",
            metric: "Overall Application Performance|Calls per Minute",
          },
          {
            title: "Stall Count",
            metric: "Overall Application Performance|Stall Count",
          },
        ];
        metricValues.forEach((v, i) => {
          push({
            type: "METRIC_VALUE",
            title: v.title,
            metricPath: v.metric,
            applicationId: appId,
            width: 3,
            height: 2,
            x: i * 3,
            y,
          });
        });
        y += 2;

        // ── Section: Business Transactions ───────────────────────────────────
        if (needsBTs && topBTs.length > 0) {
          push({
            type: "TEXT",
            title: "BT Section Header",
            text: "── Business Transactions ──",
            width: 12,
            height: 1,
            x: 0,
            y,
          });
          y += 1;

          const n = topBTs.length;
          const baseW = Math.floor(12 / n);
          const extra = 12 - baseW * n;
          let btX = 0;
          topBTs.forEach((bt, i) => {
            const w = baseW + (i < extra ? 1 : 0);
            push({
              type: "METRIC_VALUE",
              title: bt.name,
              metricPath: `Business Transaction Performance|Business Transactions|${bt.tierName}|${bt.name}|Average Response Time (ms)`,
              applicationId: appId,
              width: w,
              height: 2,
              x: btX,
              y,
            });
            btX += w;
          });
          y += 2;
        }

        // ── Section: Infrastructure ──────────────────────────────────────────
        if (needsTiers && topTiers.length > 0) {
          push({
            type: "TEXT",
            title: "Infrastructure Section Header",
            text: "── Infrastructure ──",
            width: 12,
            height: 1,
            x: 0,
            y,
          });
          y += 1;

          const n = topTiers.length;
          const baseW = Math.floor(12 / n);
          const extra = 12 - baseW * n;
          topTiers.forEach((tier, i) => {
            push({
              type: "TIMESERIES_GRAPH",
              title: `${tier.name} - Response Time`,
              metricPath: `Overall Application Performance|${tier.name}|Average Response Time (ms)`,
              applicationId: appId,
              width: i === n - 1 ? baseW + extra : baseW,
              height: 3,
              x: i * baseW,
              y,
            });
          });
          y += 3;
        }

        // ── Section: Health Status ───────────────────────────────────────────
        if (needsHealth) {
          push({
            type: "TEXT",
            title: "Health Section Header",
            text: "── Health Status ──",
            width: 12,
            height: 1,
            x: 0,
            y,
          });
          y += 1;

          push({
            type: "HEALTH_LIST",
            title: "Health Rules Status",
            applicationId: appId,
            entityType: "APPLICATION",
            width: 12,
            height: 4,
            x: 0,
            y,
          });
          y += 4;
        }

        // ── Compose full dashboard definition in memory ───────────────────────
        const canvasHeight = Math.max(768, y * 60 + 60);
        const builtWidgets = widgets.map((w, i) => buildWidgetPayload(w, i));

        const shell = {
          name: dashName,
          description: `Auto-generated ${focus} dashboard for ${appName}`,
          height: canvasHeight,
          width: 1024,
          canvasType: "CANVAS_TYPE_GRID",
          templateEntityType: "APPLICATION_COMPONENT_NODE",
          minimized: false,
          color: COLOR_LIGHT_GRAY,
          backgroundColor: COLOR_LIGHT_GRAY,
          template: false,
          warRoom: false,
          disabled: false,
          refreshInterval: 120000,
          minutesBeforeAnchorTime: timeRangeMinutes,
          startTime: -1,
          endTime: -1,
          layoutType: "",
          properties: [],
          widgets: [] as unknown[],
        };

        // ── Import pattern: create shell → fetch canonical object → add widgets
        const created = await appdPost<Dashboard>(
          "/controller/restui/dashboards/createDashboard",
          shell
        );

        const createdId = (created as { id?: number }).id;
        const fetched = await appdGetRaw<Dashboard>(
          `/controller/restui/dashboards/dashboardIfUpdated/${createdId}/-1`
        );

        await appdPost<Dashboard>(
          "/controller/restui/dashboards/updateDashboard",
          { ...fetched, height: canvasHeight, widgets: builtWidgets }
        );

        return textResponse(
          `Dashboard "${dashName}" created successfully (ID: ${createdId ?? "unknown"}).`
        );
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── Export Dashboard ────────────────────────────────────────────────────────

  server.registerTool(
    "appd_export_dashboard",
    {
      title: "Export Dashboard JSON",
      description: `Export a dashboard as a portable JSON definition.

The exported JSON can be used to recreate the dashboard in another controller or back it up.

Args:
  - dashboardId (number): Dashboard ID to export

Returns: Complete dashboard JSON definition suitable for import.`,
      inputSchema: ExportSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ dashboardId }) => {
      try {
        const dashboard = await appdGetRaw<Dashboard>(
          `/controller/CustomDashboardImportExportServlet`,
          { dashboardId }
        );
        return textResponse(JSON.stringify(dashboard, null, 2));
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── Import Dashboard ────────────────────────────────────────────────────────

  server.registerTool(
    "appd_import_dashboard",
    {
      title: "Import Dashboard from JSON",
      description: `Create a new dashboard from a JSON definition string.

Accepts the JSON output of appd_export_dashboard (or any saved dashboard JSON file) and creates a new dashboard from it. The original ID is always discarded — AppDynamics assigns a fresh one.

Typical workflow:
  1. appd_export_dashboard → save JSON to a file
  2. Edit the file if needed (rename, adjust metrics, etc.)
  3. appd_import_dashboard with the file contents → new dashboard created

Args:
  - dashboardJson (string): Full dashboard JSON (paste contents of an exported file)
  - dashboardName (string, optional): Override the name from the JSON

Returns: The newly created dashboard with its new ID.`,
      inputSchema: {
        dashboardJson: z
          .string()
          .min(2)
          .describe(
            "Full dashboard JSON definition — paste the contents of an exported dashboard file."
          ),
        dashboardName: z
          .string()
          .optional()
          .describe("Override the dashboard name from the JSON."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ dashboardJson, dashboardName }) => {
      try {
        // Parse and validate
        let raw: unknown;
        try {
          raw = JSON.parse(dashboardJson);
        } catch {
          return handleError(
            new Error(
              "Invalid JSON: could not parse dashboardJson. Make sure you pasted the complete JSON content."
            )
          );
        }

        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          return handleError(
            new Error(
              "dashboardJson must be a JSON object. Got: " +
                (Array.isArray(raw) ? "array" : typeof raw)
            )
          );
        }

        const parsed = raw as Record<string, unknown>;

        // Resolve name
        const resolvedName =
          dashboardName ??
          (typeof parsed.name === "string" ? parsed.name : null);
        if (!resolvedName) {
          return handleError(
            new Error(
              "Dashboard JSON has no 'name' field. Use the dashboardName parameter to set one."
            )
          );
        }

        // Extract the widget array — handles both real export format
        // (widgetTemplates) and RESTUI internal format (widgets).
        const importedWidgets = Array.isArray(parsed.widgetTemplates)
          ? (parsed.widgetTemplates as Record<string, unknown>[])
          : Array.isArray(parsed.widgets)
          ? (parsed.widgets as Record<string, unknown>[])
          : [];

        // ── Step 1: Create a blank dashboard with correct metadata ───────────
        // Posting the raw export JSON to createDashboard causes a 400 because
        // the export format differs from the restui create format.
        // We create a minimal blank shell first, then attach the widgets.
        const blankPayload = {
          name: resolvedName,
          description:
            typeof parsed.description === "string"
              ? parsed.description
              : null,
          height:
            typeof parsed.height === "number" ? parsed.height : 768,
          width:
            typeof parsed.width === "number" ? parsed.width : 1024,
          canvasType: "CANVAS_TYPE_GRID",
          templateEntityType: "APPLICATION_COMPONENT_NODE",
          minimized: false,
          color: COLOR_LIGHT_GRAY,
          backgroundColor: COLOR_LIGHT_GRAY,
          template: false,
          warRoom: false,
          disabled: false,
          refreshInterval: 120000,
          minutesBeforeAnchorTime: -1,
          startTime: -1,
          endTime: -1,
          layoutType: "",
          properties: [],
          widgets: [],
        };

        const created = await appdPost<Dashboard>(
          "/controller/restui/dashboards/createDashboard",
          blankPayload
        );

        // ── Step 2: Fetch authoritative object, then restore widgets ─────────
        const newId = (created as { id?: number }).id;
        const fetched = await appdGetRaw<Dashboard>(
          `/controller/restui/dashboards/dashboardIfUpdated/${newId}/-1`
        );

        await appdPost<Dashboard>(
          "/controller/restui/dashboards/updateDashboard",
          {
            ...fetched,
            height: blankPayload.height,
            width: blankPayload.width,
            widgets: importedWidgets,
          }
        );

        return textResponse(
          `Dashboard "${resolvedName}" imported successfully (ID: ${newId ?? "unknown"}).`
        );
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── Save Dashboard Definition to File ──────────────────────────────────────

  server.registerTool(
    "appd_save_dashboard_file",
    {
      title: "Save Dashboard Definition to File",
      description: `Build a complete AppDynamics dashboard JSON definition and save it to a local file — without creating anything in AppDynamics yet.

The saved file can be:
  - Inspected or edited before importing
  - Version-controlled alongside your code
  - Imported with appd_import_dashboard at any time

The file format is identical to appd_export_dashboard output and is directly importable.

Widget types (use exact names):
  - "TIMESERIES_GRAPH": Time-series chart (needs applicationId + metricPath)
  - "METRIC_VALUE": Single metric number (needs applicationId + metricPath)
  - "HEALTH_LIST": Health status list (needs applicationId + entityType)
  - "TEXT": Static label or section heading (needs text)
  - "PIE": Pie chart (needs applicationId + metricPath)
  - "GAUGE": Gauge (needs applicationId + metricPath)

Grid layout: width max is 12 (full row). Height is in grid units (1–4 typical).
Use appd_browse_metric_tree to discover metric paths.

Args:
  - name (string): Dashboard name
  - filePath (string, optional): Where to write the file. Default: ./dashboard-{name}.json
  - description (string, optional): Dashboard description
  - height/width (number, optional): Canvas size in pixels (default: 768×1024)
  - widgets (array, optional): Widget definitions

Returns: Absolute path of the saved file and a widget summary.`,
      inputSchema: {
        name: z.string().min(1).describe("Dashboard name."),
        filePath: z
          .string()
          .optional()
          .describe(
            "File path to save the JSON. Default: ./dashboard-{slugified-name}.json"
          ),
        description: z.string().optional().describe("Dashboard description."),
        height: z
          .number()
          .int()
          .min(100)
          .optional()
          .describe("Canvas height in pixels. Default: 768."),
        width: z
          .number()
          .int()
          .min(100)
          .optional()
          .describe("Canvas width in pixels. Default: 1024."),
        widgets: z
          .array(WidgetSchema)
          .optional()
          .describe("Widgets to include. Same format as appd_create_dashboard."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ name, filePath, description, height, width, widgets }) => {
      try {
        const builtWidgets = (widgets ?? []).map((w, i) =>
          buildExportWidgetPayload(w, i)
        );

        const dashboardPayload = buildExportDashboardEnvelope(
          name,
          description ?? null,
          height ?? 768,
          width ?? 1024,
          builtWidgets,
        );

        const json = JSON.stringify(dashboardPayload, null, 2);

        const slug = name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
        const outputPath = resolve(filePath ?? `./dashboard-${slug}.json`);

        await writeFile(outputPath, json, "utf-8");

        const widgetSummary = builtWidgets
          .map((w) => `  - [${String(w.widgetType)}] ${String(w.title)}`)
          .join("\n");

        return textResponse(
          `Dashboard definition saved to:\n${outputPath}\n\n` +
            `Name: ${name}\n` +
            `Widgets: ${builtWidgets.length}\n` +
            `Canvas: ${width ?? 1024} × ${height ?? 768} px\n\n` +
            (builtWidgets.length > 0
              ? `Widgets included:\n${widgetSummary}\n\n`
              : "") +
            `To create in AppDynamics:\n` +
            `  appd_import_dashboard with the contents of this file`
        );
      } catch (error) {
        return handleError(error);
      }
    }
  );
}

// ── Widget Builder ────────────────────────────────────────────────────────────

interface WidgetInput {
  type: string;
  title: string;
  height: number;
  width: number;
  x: number;
  y: number;
  applicationId?: number;
  applicationName?: string;
  metricPath?: string;
  entityType?: string;
  text?: string;
  description?: string;
  adqlQuery?: string;
}

// ── Export Format Builders ────────────────────────────────────────────────────
// These produce the same JSON structure that AppDynamics generates when you
// export a dashboard via the UI — suitable for save_dashboard_file and import.

const EXPORT_TYPE_MAP: Record<string, string> = {
  TIMESERIES_GRAPH: "AdvancedGraph",
  METRIC_VALUE: "MetricValue",
  HEALTH_LIST: "HealthListWidget",
  TEXT: "TextWidget",
  PIE: "PieWidget",
  GAUGE: "GaugeWidget",
  ANALYTICS: "AnalyticsWidget",
  // pass-through if already in export class-name form
  AdvancedGraph: "AdvancedGraph",
  MetricValue: "MetricValue",
  HealthListWidget: "HealthListWidget",
  TextWidget: "TextWidget",
  PieWidget: "PieWidget",
  GaugeWidget: "GaugeWidget",
  AnalyticsWidget: "AnalyticsWidget",
};

/**
 * Build a widget in the AppDynamics export/import JSON format.
 * Matches what AppDynamics produces when you click Export Dashboard in the UI.
 * Key differences from the RESTUI format:
 *   - widgetType uses class names (GaugeWidget, AdvancedGraph, etc.)
 *   - metrics live in dataSeriesTemplates[].metricMatchCriteriaTemplate
 *   - inputMetricPath uses Root||Applications||AppName|| prefix
 *   - backgroundColorsStr is a comma-separated string, backgroundColors is null
 */
function buildExportWidgetPayload(w: WidgetInput, index: number): Record<string, unknown> {
  const widgetType = EXPORT_TYPE_MAP[w.type] ?? w.type;

  // Base fields common to all widget types (from real export example)
  const base: Record<string, unknown> = {
    widgetType,
    title: w.title,
    height: w.height,
    width: w.width,
    minHeight: 0,
    minWidth: 0,
    x: w.x,
    y: w.y,
    label: null,
    description: w.description ?? null,
    drillDownUrl: null,
    openUrlInCurrentTab: false,
    useMetricBrowserAsDrillDown: widgetType !== "TextWidget" && widgetType !== "AnalyticsWidget",
    drillDownActionType: null,
    backgroundColor: COLOR_WHITE,
    backgroundColors: null,
    backgroundColorsStr: `${COLOR_WHITE},${COLOR_WHITE}`,
    color: COLOR_DARK,
    fontSize: 12,
    useAutomaticFontSize: false,
    borderEnabled: false,
    borderThickness: 0,
    borderColor: COLOR_BORDER,
    backgroundAlpha: 1,
    showValues: true,
    formatNumber: null,
    numDecimals: 0,
    removeZeros: null,
    compactMode: false,
    showTimeRange: false,
    renderIn3D: false,
    showLegend: null,
    legendPosition: null,
    legendColumnCount: null,
    timeRangeSpecifierType: "BEFORE_NOW",
    startTime: null,
    endTime: null,
    minutesBeforeAnchorTime: 15,
    isGlobal: true,
    propertiesMap: null,
    dataSeriesTemplates: null,
  };

  // ── TextWidget ────────────────────────────────────────────────────────────
  if (widgetType === "TextWidget") {
    base.useMetricBrowserAsDrillDown = false;
    base.text = w.text ?? "";
    return base;
  }

  // ── AnalyticsWidget ───────────────────────────────────────────────────────
  if (widgetType === "AnalyticsWidget") {
    base.useMetricBrowserAsDrillDown = false;
    base.showValues = false;
    base.formatNumber = true;
    base.numDecimals = 2;
    base.removeZeros = true;
    base.borderColor = 0;
    base.color = 3342336;           // AppDynamics analytics blue
    base.backgroundColorsStr = null;
    base.adqlQueryList = w.adqlQuery ? [w.adqlQuery] : [];
    base.analyticsWidgetType = "TABLE";
    base.searchMode = "ADVANCED";
    base.isStackingEnabled = false;
    base.legendsLayout = null;
    base.maxAllowedYAxisFields = 10;
    base.maxAllowedXAxisFields = 10;
    base.min = null;
    base.interval = null;
    base.max = null;
    base.intervalType = null;
    base.maxType = null;
    base.minType = null;
    base.showMinExtremes = false;
    base.showMaxExtremes = false;
    base.displayPercentileMarkers = false;
    base.percentileValue1 = null;
    base.percentileValue2 = null;
    base.percentileValue3 = null;
    base.percentileValue4 = null;
    base.isShowLogYAxis = false;
    base.resolution = null;
    base.dataFetchSize = null;
    base.percentileLine = null;
    base.timeRangeInterval = null;
    base.pollingInterval = null;
    base.unit = 0;
    base.isRawQuery = true;
    base.viewState = null;
    base.gridState = null;
    base.slmConfigId = null;
    base.bjId = null;
    base.showInverse = false;
    base.showHealth = false;
    base.align = "center";
    base.compareToOption = null;
    base.trailingPeriod = null;
    base.trailingPeriodUnit = null;
    base.isIncreaseGood = null;
    base.numberFormatOption = null;
    base.showUnivariateLabel = true;
    return base;
  }

  // ── Metric-based widgets (GaugeWidget, AdvancedGraph, MetricValue, PieWidget) ──
  if (w.metricPath) {
    const appName = w.applicationName ?? String(w.applicationId ?? "");
    // inputMetricPath mirrors the metric browser tree path with "||" separators
    // and a "Root||Applications||AppName||" prefix — matches the real export format.
    const inputMetricPath =
      `Root||Applications||${appName}||` + w.metricPath.replace(/\|/g, "||");

    base.dataSeriesTemplates = [
      {
        seriesType: "LINE",
        metricType: "METRIC_DATA",
        showRawMetricName: false,
        colorPalette: null,
        name: `Series ${index}`,
        metricMatchCriteriaTemplate: {
          entityMatchCriteria: null,
          metricExpressionTemplate: {
            metricExpressionType: "Absolute",
            functionType: "VALUE",
            displayName: "null",
            inputMetricText: false,
            inputMetricPath,
            metricPath: w.metricPath,
            scopeEntity: {
              applicationName: appName,
              entityType: "APPLICATION",
              entityName: appName,
              scopingEntityType: null,
              scopingEntityName: null,
              subtype: null,
            },
          },
          rollupMetricData: true,
          expressionString: "",
          useActiveBaseline: false,
          sortResultsAscending: false,
          maxResults: 20,
          evaluationScopeType: null,
          baselineName: null,
          applicationName: appName,
          metricDisplayNameStyle: "DISPLAY_STYLE_CUSTOM",
          metricDisplayNameCustomFormat: "${m}",
          includeHistoricalNodes: false,
        },
        axisPosition: null,
      },
    ];
  }

  // Widget-type-specific extra fields
  if (widgetType === "GaugeWidget") {
    base.showLabels = true;
    base.showPercentValues = null;
    base.useMinMaxValues = true;
    base.minValue = 0;
    base.maxValue = 100;
    base.invertColors = false;
  }

  if (widgetType === "AdvancedGraph") {
    base.showValues = false;
    base.showLegend = true;
    base.legendPosition = "POSITION_BOTTOM";
    base.legendColumnCount = 1;
  }

  return base;
}

/**
 * Wrap widget array in the top-level envelope that AppDynamics uses for
 * exported dashboard JSON files. This is the structure you get from
 * "Export Dashboard" in the AppDynamics UI.
 */
function buildExportDashboardEnvelope(
  name: string,
  description: string | null,
  height: number,
  width: number,
  widgetTemplates: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    schemaVersion: null,
    dashboardFormatVersion: "4.0",
    name,
    description,
    properties: null,
    templateEntityType: "APPLICATION_COMPONENT_NODE",
    associatedEntityTemplates: null,
    timeRangeSpecifierType: "GLOBAL",
    minutesBeforeAnchorTime: -1,
    startDate: null,
    endDate: null,
    refreshInterval: 120000,
    backgroundColor: COLOR_LIGHT_GRAY,
    color: COLOR_LIGHT_GRAY,
    height,
    width,
    canvasType: "CANVAS_TYPE_GRID",
    layoutType: "",
    widgetTemplates,
    warRoom: false,
    template: false,
  };
}

// ── RESTUI Format Builder ─────────────────────────────────────────────────────

/**
 * Build a widget payload that matches the AppDynamics restui dashboard API format.
 * Reverse-engineered from real dashboard responses.
 */
function buildWidgetPayload(
  w: WidgetInput,
  index: number
): Record<string, unknown> {
  // Map friendly type aliases to actual API types
  const typeMap: Record<string, string> = {
    AdvancedGraph: "TIMESERIES_GRAPH",
    MetricValue: "METRIC_VALUE",
    HealthListWidget: "HEALTH_LIST",
    TextWidget: "TEXT",
    PieWidget: "PIE",
    GaugeWidget: "GAUGE",
  };
  const apiType = typeMap[w.type] ?? w.type;

  // Common base properties matching the real API format
  const base: Record<string, unknown> = {
    title: w.title,
    type: apiType,
    height: w.height,
    width: w.width,
    x: w.x,
    y: w.y,
    label: w.title,
    description: w.description ?? null,
    drillDownUrl: null,
    openUrlInCurrentTab: false,
    useMetricBrowserAsDrillDown: true,
    drillDownActionType: null,
    backgroundColor: COLOR_WHITE,
    color: COLOR_DARK,
    fontSize: 12,
    useAutomaticFontSize: false,
    borderEnabled: false,
    borderThickness: 0,
    borderColor: COLOR_BORDER,
    backgroundAlpha: 1.0,
    showValues: false,
    formatNumber: true,
    numDecimals: 0,
    removeZeros: true,
    backgroundColors: [COLOR_WHITE, COLOR_WHITE],
    compactMode: false,
    showTimeRange: false,
    renderIn3D: false,
    isGlobal: true,
    properties: [],
    missingEntities: null,
    minHeight: 0,
    minWidth: 0,
    widgetsMetricMatchCriterias: null,
    timeRangeSpecifierType: "UNKNOWN",
    startTime: null,
    endTime: null,
    customTimeRange: null,
    minutesBeforeAnchorTime: 15,
  };

  // ── TEXT widget ─────────────────────────────────────────────────────────
  if (apiType === "TEXT") {
    base.text = w.text ?? "";
    base.useMetricBrowserAsDrillDown = false;
    return base;
  }

  // ── HEALTH_LIST widget ──────────────────────────────────────────────────
  if (apiType === "HEALTH_LIST") {
    base.useMetricBrowserAsDrillDown = false;
    base.applicationId = w.applicationId ?? null;
    base.entityType = w.entityType ?? "APPLICATION";
    base.entitySelectionType = "ALL";
    base.entityIds = [];
    base.iconSize = 20;
    base.iconPosition = "LEFT";
    base.showSearchBox = false;
    base.showList = true;
    base.showListHeader = false;
    base.showBarPie = true;
    base.showPie = false;
    base.innerRadius = 0;
    base.aggregationType = "RATIO";
    base.showCurrentHealthStatus = false;
    return base;
  }

  // ── Metric-based widgets: TIMESERIES_GRAPH, METRIC_VALUE, PIE, GAUGE ──
  if (w.metricPath && w.applicationId) {
    const pathParts = w.metricPath.split("|");
    const displayName = pathParts[pathParts.length - 1] ?? w.metricPath;

    base.widgetsMetricMatchCriterias = [
      {
        name: `Series ${index + 1}`,
        nameUnique: true,
        metricMatchCriteria: {
          applicationId: w.applicationId,
          metricExpression: {
            type: "LEAF_METRIC_EXPRESSION",
            literalValueExpression: false,
            literalValue: 0,
            metricDefinition: {
              type: "LOGICAL_METRIC",
              logicalMetricName: null,
              scope: null,
              metricId: 0,
            },
            functionType: "VALUE",
            displayName,
            inputMetricText: true,
            inputMetricPath: w.metricPath,
            value: 0,
          },
          rollupMetricData: true,
          expressionString: "",
          metricDisplayNameStyle: "DISPLAY_STYLE_AUTO",
          metricDisplayNameCustomFormat: null,
          metricDataFilter: {
            sortResultsAscending: false,
            maxResults: 10,
          },
          useActiveBaseline: false,
          baselineId: 0,
          includeAbove: false,
          includeBelow: false,
          includeBoth: false,
          includeBand12: false,
          includeBand23: false,
          includeBand34: false,
          includeBand45: false,
          includeShade: false,
          isIncludeAllInactiveServers: false,
          includeHistoricalNodes: false,
          excludeMaintenanceWindow: false,
          missingEntities: null,
        },
        seriesType: apiType === "PIE" ? "LINE" : "LINE",
        axisPosition: "LEFT",
        showRawMetricName: false,
        metricType: "METRIC_DATA",
        colorPalette: null,
      },
    ];

    // TIMESERIES_GRAPH extras
    if (apiType === "TIMESERIES_GRAPH") {
      base.showLegend = true;
      base.legendPosition = "POSITION_BOTTOM";
      base.legendColumnCount = 1;
      base.verticalAxisLabel = null;
      base.hideHorizontalAxis = null;
      base.horizontalAxisLabel = null;
      base.axisType = "LINEAR";
      base.stackMode = null;
      base.multipleYAxis = null;
      base.showEvents = null;
      base.eventFilter = null;
      base.interpolateDataGaps = false;
      base.showAllTooltips = null;
      base.staticThresholds = null;
    }

    // PIE extras
    if (apiType === "PIE") {
      base.showLabels = true;
      base.showLegend = true;
      base.legendPosition = "POSITION_BOTTOM";
      base.legendColumnCount = 1;
    }

    return base;
  }

  // Widget without metric binding
  if (w.applicationId) {
    base.applicationId = w.applicationId;
  }

  return base;
}
