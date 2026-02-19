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

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGetRaw, appdPost } from "../services/api-client.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { truncateIfNeeded } from "../utils/formatting.js";
import type { Dashboard, DashboardSummary } from "../types.js";

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
  metricPath?: string;
  entityType?: string;
  text?: string;
  description?: string;
}

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
