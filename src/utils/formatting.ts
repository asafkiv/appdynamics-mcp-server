/**
 * Response formatting utilities.
 * Helps create concise, readable responses that minimize token usage.
 */

import { CHARACTER_LIMIT } from "../constants.js";

/**
 * Truncate a JSON response if it exceeds CHARACTER_LIMIT.
 * Returns the truncated string with a note about truncation.
 */
export function truncateIfNeeded(
  data: unknown,
  context?: string
): string {
  const json = JSON.stringify(data, null, 2);

  if (json.length <= CHARACTER_LIMIT) {
    return json;
  }

  // If it's an array, truncate the array
  if (Array.isArray(data)) {
    const half = Math.max(1, Math.floor(data.length / 2));
    const truncated = data.slice(0, half);
    const truncatedJson = JSON.stringify(truncated, null, 2);
    const note = `\n\n--- TRUNCATED: Showing ${half} of ${data.length} items. Use pagination or filters to see more. ${context ?? ""} ---`;
    return truncatedJson + note;
  }

  // For non-array data, just truncate the string
  const truncated = json.slice(0, CHARACTER_LIMIT);
  return (
    truncated +
    `\n\n--- TRUNCATED: Response exceeded ${CHARACTER_LIMIT} characters. Use filters to narrow results. ---`
  );
}

/**
 * Format a Unix timestamp (milliseconds) to a human-readable string.
 */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

/**
 * Format a duration in milliseconds to human-readable form.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Build a Markdown summary table from key-value pairs.
 */
export function markdownTable(
  headers: string[],
  rows: string[][]
): string {
  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
  return `${header}\n${separator}\n${body}`;
}
