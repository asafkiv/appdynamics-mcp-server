/**
 * Centralized error handling for tool responses.
 */

import type { ToolResponse } from "../types.js";

interface AxiosLikeError extends Error {
  isAxiosError: boolean;
  response?: {
    status: number;
    data: unknown;
  };
  code?: string;
}

function isAxiosError(error: unknown): error is AxiosLikeError {
  return (
    error instanceof Error &&
    "isAxiosError" in error &&
    (error as AxiosLikeError).isAxiosError === true
  );
}

/**
 * Convert any error into a structured MCP tool error response.
 * Provides actionable messages for common HTTP status codes.
 */
export function handleError(error: unknown): ToolResponse {
  if (isAxiosError(error)) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      const dataStr =
        typeof data === "string" ? data : JSON.stringify(data);

      switch (status) {
        case 401:
          return errorResponse(
            `Authentication failed (401). Check APPD_CLIENT_NAME, APPD_CLIENT_SECRET, and APPD_ACCOUNT_NAME.`
          );
        case 403:
          return errorResponse(
            `Permission denied (403). The API client may not have access to this resource.`
          );
        case 404:
          return errorResponse(
            `Resource not found (404). Verify the application ID or resource ID is correct.`
          );
        case 429:
          return errorResponse(
            `Rate limit exceeded (429). Wait a moment before retrying.`
          );
        default:
          return errorResponse(`API error ${status}: ${dataStr}`);
      }
    }

    if (error.code === "ECONNABORTED") {
      return errorResponse(
        "Request timed out. The AppDynamics controller may be slow or unreachable. Try again or increase the timeout."
      );
    }

    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      return errorResponse(
        `Cannot reach AppDynamics controller. Check that APPD_URL is correct and the controller is accessible.`
      );
    }

    return errorResponse(`Network error: ${error.message}`);
  }

  const message =
    error instanceof Error ? error.message : String(error);
  return errorResponse(`Error: ${message}`);
}

function errorResponse(text: string): ToolResponse {
  return {
    content: [{ type: "text" as const, text }],
    isError: true,
  };
}

/**
 * Create a successful text response.
 */
export function textResponse(text: string): ToolResponse {
  return {
    content: [{ type: "text" as const, text }],
  };
}

/**
 * Create a successful JSON response from any data.
 */
export function jsonResponse(data: unknown): ToolResponse {
  return textResponse(JSON.stringify(data, null, 2));
}
