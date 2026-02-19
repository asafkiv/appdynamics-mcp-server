/**
 * Shared constants for AppDynamics MCP Server
 */

// Maximum characters per tool response to prevent overwhelming the LLM context
export const CHARACTER_LIMIT = 50000;

// Default time ranges in minutes
export const DEFAULT_DURATION_MINS = 60;
export const DEFAULT_VIOLATIONS_DURATION_MINS = 1440; // 24 hours
export const DEFAULT_SNAPSHOT_DURATION_MINS = 30;
export const DEFAULT_ANOMALY_DURATION_MINS = 1440; // 24 hours

// Default result limits
export const DEFAULT_MAX_SNAPSHOTS = 20;
export const DEFAULT_METRIC_TREE_MAX_DEPTH = 2;

// API request timeout in milliseconds
export const API_TIMEOUT_MS = 30000;

// Token expiry safety margin in seconds (refresh 5 min before actual expiry)
export const TOKEN_EXPIRY_SAFETY_MARGIN_SECS = 300;

// AppDynamics REST API event types
export const ERROR_EVENT_TYPES = "ERROR,APPLICATION_ERROR,APPLICATION_CRASH";
export const ERROR_SEVERITIES = "ERROR,WARN";

export const ANOMALY_EVENT_TYPES = [
  "ANOMALY_OPEN_WARNING",
  "ANOMALY_OPEN_CRITICAL",
  "ANOMALY_CLOSE_WARNING",
  "ANOMALY_CLOSE_CRITICAL",
  "ANOMALY_UPGRADED",
  "ANOMALY_DOWNGRADED",
].join(",");

export const DEFAULT_ANOMALY_SEVERITIES = "INFO,WARN,ERROR";

// Dashboard widget types (restui API names)
export const WIDGET_TYPES = {
  METRIC_GRAPH: "TIMESERIES_GRAPH",
  METRIC_VALUE: "METRIC_VALUE",
  HEALTH_STATUS: "HEALTH_LIST",
  TEXT: "TEXT",
  IMAGE: "IMAGE",
  IFRAME: "IFRAME",
  PIE_CHART: "PIE",
  GAUGE: "GAUGE",
  ANALYTICS: "ANALYTICS",
} as const;

// Common BT performance metric names
export const BT_METRICS = [
  "Average Response Time (ms)",
  "Calls per Minute",
  "Errors per Minute",
  "Number of Slow Calls",
  "Number of Very Slow Calls",
  "Stall Count",
] as const;
