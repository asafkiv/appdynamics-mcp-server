/**
 * Dashboard tools: list, get, create, update, clone, delete, export.
 * Full CRUD for AppDynamics custom dashboards.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGet, appdGetRaw, appdPost, appdDelete } from "../services/api-client.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { truncateIfNeeded } from "../utils/formatting.js";
import type { Dashboard, DashboardSummary, DashboardWidget } from "../types.js";

// ── Schemas ──────────────────────────────────────────────────────────────────

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

// Widget definition schema for creating/updating dashboards
const WidgetSchema = z.object({
  type: z
    .string()
    .describe(
      "Widget type: 'AdvancedGraph' (time-series), 'MetricValue' (single number), 'HealthListWidget' (health status), 'TextWidget' (text/title), 'PieWidget' (pie chart), 'GaugeWidget' (gauge)."
    ),
  title: z.string().describe("Widget title displayed on the dashboard."),
  height: z.number().int().min(1).describe("Widget height in grid units."),
  width: z.number().int().min(1).describe("Widget width in grid units."),
  x: z.number().int().min(0).describe("X position on the dashboard grid."),
  y: z.number().int().min(0).describe("Y position on the dashboard grid."),
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
    .describe("Entity type for the widget (e.g., 'APPLICATION', 'TIER', 'NODE')."),
  text: z
    .string()
    .optional()
    .describe("Text content for TextWidget type."),
  description: z.string().optional().describe("Widget description."),
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
    .describe("Array of widgets to place on the dashboard. Can be empty to create a blank dashboard, then add widgets later."),
  backgroundColor: z
    .string()
    .optional()
    .describe("Background color hex code (e.g., '#FFFFFF'). Default: white."),
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
  backgroundColor: z.string().optional().describe("New background color."),
};

const AddWidgetSchema = {
  dashboardId: z.number().int().describe("The ID of the dashboard to add a widget to."),
  widget: WidgetSchema.describe("The widget to add to the dashboard."),
};

// ── Registration ─────────────────────────────────────────────────────────────

export function registerDashboardTools(server: McpServer): void {
  // ── List Dashboards ────────────────────────────────────────────────────────

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

  // ── Get Dashboard Details ──────────────────────────────────────────────────

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

  // ── Create Dashboard ───────────────────────────────────────────────────────

  server.registerTool(
    "appd_create_dashboard",
    {
      title: "Create Dashboard",
      description: `Create a new custom dashboard in AppDynamics.

You can create a blank dashboard and add widgets later using appd_add_widget_to_dashboard, or provide widgets upfront.

Widget types:
  - "AdvancedGraph": Time-series graph (needs applicationId + metricPath)
  - "MetricValue": Single metric value display (needs applicationId + metricPath)
  - "HealthListWidget": Health status list (needs applicationId + entityType)
  - "TextWidget": Static text or title (needs text)
  - "PieWidget": Pie chart
  - "GaugeWidget": Gauge display

Use appd_browse_metric_tree to discover metric paths for widgets.

Args:
  - name (string): Dashboard name
  - description (string, optional): Description
  - height/width (number, optional): Canvas size (default: 768x1024)
  - widgets (array, optional): Widgets to place on the dashboard
  - backgroundColor (string, optional): Background color
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
    async ({ name, description, height, width, widgets, backgroundColor, template }) => {
      try {
        const dashboardPayload = {
          name,
          description: description ?? "",
          height: height ?? 768,
          width: width ?? 1024,
          canvasType: "ABSOLUTE",
          templateEntityType: "APPLICATION_COMPONENT_NODE",
          minimized: false,
          color: "#000000",
          backgroundColor: backgroundColor ?? "#FFFFFF",
          backgroundType: "SOLID",
          template: template ?? false,
          warRoom: false,
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

  // ── Update Dashboard ───────────────────────────────────────────────────────

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
  - backgroundColor (string, optional): New background color

Returns: The updated dashboard object.`,
      inputSchema: UpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ dashboardId, name, description, height, width, widgets, backgroundColor }) => {
      try {
        // Fetch existing dashboard
        const existing = await appdGetRaw<Dashboard>(
          `/controller/restui/dashboards/dashboardIfUpdated/${dashboardId}/-1`
        );

        // Merge updates
        const updated = {
          ...existing,
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(height !== undefined && { height }),
          ...(width !== undefined && { width }),
          ...(backgroundColor !== undefined && { backgroundColor }),
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

  // ── Add Widget to Dashboard ────────────────────────────────────────────────

  server.registerTool(
    "appd_add_widget_to_dashboard",
    {
      title: "Add Widget to Dashboard",
      description: `Add a single widget to an existing dashboard without replacing existing widgets.

This fetches the current dashboard, appends the new widget, and saves it.

Widget types:
  - "AdvancedGraph": Time-series graph (needs applicationId + metricPath)
  - "MetricValue": Single metric value (needs applicationId + metricPath)
  - "HealthListWidget": Health status (needs applicationId + entityType)
  - "TextWidget": Static text (needs text property in description)

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
        // Fetch existing dashboard
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

  // ── Clone Dashboard ────────────────────────────────────────────────────────

  server.registerTool(
    "appd_clone_dashboard",
    {
      title: "Clone Dashboard",
      description: `Clone an existing dashboard with a new name.

Creates an exact copy of the source dashboard (including all widgets) with the specified new name. Useful for creating environment-specific copies (e.g., clone "Prod Monitoring" to "Staging Monitoring").

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
        // Fetch the source dashboard
        const source = await appdGetRaw<Dashboard>(
          `/controller/restui/dashboards/dashboardIfUpdated/${dashboardId}/-1`
        );

        // Remove id and set new name
        const { id: _id, ...cloneData } = source;
        const clonePayload = {
          ...cloneData,
          name: newName,
        };

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

  // ── Delete Dashboard ───────────────────────────────────────────────────────

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
          `/controller/restui/dashboards/deleteDashboard`,
          dashboardId
        );
        return textResponse(
          `Dashboard ${dashboardId} deleted successfully.`
        );
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── Export Dashboard ───────────────────────────────────────────────────────

  server.registerTool(
    "appd_export_dashboard",
    {
      title: "Export Dashboard JSON",
      description: `Export a dashboard as a portable JSON definition.

The exported JSON can be used to recreate the dashboard in another controller, back it up, or use it as a template for appd_create_dashboard.

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
}

// ── Widget Helpers ──────────────────────────────────────────────────────────

interface WidgetInput {
  type: string;
  title: string;
  height: number;
  width: number;
  x: number;
  y: number;
  applicationId?: number;
  metricPath?: string;
  entityType?: string;
  text?: string;
  description?: string;
}

function buildWidgetPayload(
  w: WidgetInput,
  index: number
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: w.type,
    title: w.title,
    height: w.height,
    width: w.width,
    x: w.x,
    y: w.y,
    label: w.title,
    description: w.description ?? "",
    drillDownUrl: "",
    useMetricBrowserAsDrillDown: true,
    backgroundColor: "rgba(0,0,0,0)",
    useAutomaticFontSize: true,
    minHeight: 0,
    minWidth: 0,
  };

  // Add metric-specific properties
  if (w.applicationId) {
    base.applicationId = w.applicationId;
  }

  if (w.metricPath) {
    base.metricPath = w.metricPath;
  }

  if (w.entityType) {
    base.entityType = w.entityType;
    base.entitySelectionType = "SPECIFIC_ENTITY";
  }

  // Text widget content
  if (w.type === "TextWidget" && w.text) {
    base.text = w.text;
    base.propertiesMap = {
      fontFamily: "Arial",
      fontSize: 14,
      textAlign: "center",
      color: "#000000",
    };
  }

  // Health widget defaults
  if (w.type === "HealthListWidget") {
    base.entitySelectionType = w.entityType
      ? "SPECIFIC_ENTITY"
      : "ALL";
  }

  // Graph widget defaults
  if (
    w.type === "AdvancedGraph" &&
    w.metricPath &&
    w.applicationId
  ) {
    base.dataSeriesTemplateMap = {
      [`series-${index}`]: {
        metricMatchCriteriaTemplate: {
          metricExpressionTemplate: {
            metricExpressionType: "ABSOLUTE",
            metricPath: w.metricPath,
          },
          entityMatchCriteria: {
            applicationId: w.applicationId,
          },
        },
      },
    };
  }

  return base;
}
