# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AppDynamics MCP Server — a Model Context Protocol server that exposes AppDynamics SaaS REST API data to MCP-compatible clients (e.g., Cursor, VS Code).

## Running

No build step is needed. TypeScript is executed directly via `tsx`.

- **MCP server**: `npx tsx src/index.ts` (launched automatically by MCP clients via stdio transport)
- **Install dependencies**: `npm install`
- **Tests**: Not yet implemented (`npm test` exits with error)

## Architecture

### `src/index.ts` — MCP Server
- Registers 9 MCP tools: `get_applications`, `get_health_violations`, `get_bt_list`, `get_bt_performance`, `get_anomalies`, `get_tiers_and_nodes`, `get_snapshots`, `get_errors`, `get_metric_data`
- Uses `@modelcontextprotocol/sdk` with `StdioServerTransport`
- Credentials come from environment variables (no `.env` loading; the MCP client provides env vars)
- Exposes tools via `ListToolsRequestSchema` and handles calls via `CallToolRequestSchema`

### Authentication
- **Primary**: OAuth2 client credentials flow → `POST /controller/api/oauth/access_token`
- Client ID formatted as `clientName@accountName` when `APPD_ACCOUNT_NAME` is set
- Token cached with 5-minute safety margin before expiry
- **Fallback**: Direct API key if only `APPD_CLIENT_NAME` is set (no secret)

### API Resilience
Health violations fetching has multiple fallback layers:
1. Tries `/problems/healthrule-violations` endpoint first
2. Falls back to `/problems` endpoint on 404
3. Handles multiple response shapes: `healthRuleViolations`, `violations`, `data`, or `problems` array

## Environment Variables

| Variable | Description |
|---|---|
| `APPD_URL` | AppDynamics controller URL (e.g., `https://your-account.saas.appdynamics.com`) |
| `APPD_CLIENT_NAME` | OAuth client name or API key |
| `APPD_CLIENT_SECRET` | OAuth client secret |
| `APPD_ACCOUNT_NAME` | Optional, for `clientName@accountName` format |

## Key Details

- ES Modules (`"type": "module"` in package.json) — use `.js` extensions in imports
- TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- Target: ES2022, Module resolution: Node16
- AppDynamics base URL is configurable via `APPD_URL` environment variable

- always update README.MD when adding new capabilites or fixing bugs
