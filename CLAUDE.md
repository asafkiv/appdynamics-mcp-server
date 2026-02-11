# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AppDynamics MCP Server — a Model Context Protocol server that exposes AppDynamics SaaS REST API data to MCP-compatible clients (e.g., Cursor). It also includes a standalone background monitoring service that creates/resolves Jira tickets based on health rule violations.

## Running

No build step is needed. TypeScript is executed directly via `tsx`.

- **MCP server**: `npx tsx src/index.ts` (launched automatically by MCP clients via stdio transport)
- **Background monitor**: `npm run monitor` (or `npx tsx src/monitor.ts`)
- **Install dependencies**: `npm install`
- **Tests**: Not yet implemented (`npm test` exits with error)

## Architecture

The codebase has two independent entry points that share no code between them (OAuth logic is duplicated):

### `src/index.ts` — MCP Server
- Registers two MCP tools: `get_applications` and `get_health_violations`
- Uses `@modelcontextprotocol/sdk` with `StdioServerTransport`
- Credentials come from environment variables (no `.env` loading; the MCP client provides env vars)
- Exposes tools via `ListToolsRequestSchema` and handles calls via `CallToolRequestSchema`

### `src/monitor.ts` — Background Monitoring Service
- Polls AppDynamics for health violations on a configurable interval (default: 60s)
- Creates Jira tickets (via REST API v2) for new violations, transitions them to "Done" when resolved
- Persists state to `violations-state.json` (incident ID → Jira ticket key mapping)
- Loads `.env` via `dotenv` (unlike the MCP server)
- Handles graceful shutdown on SIGINT/SIGTERM by saving state

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

| Variable | Used By | Description |
|---|---|---|
| `APPD_CLIENT_NAME` | Both | OAuth client name or API key |
| `APPD_CLIENT_SECRET` | Both | OAuth client secret |
| `APPD_ACCOUNT_NAME` | Both | Optional, for `clientName@accountName` format |
| `JIRA_URL` | Monitor | Jira instance URL |
| `JIRA_USERNAME` | Monitor | Jira username (email) |
| `JIRA_TOKEN` | Monitor | Jira API token |
| `JIRA_PROJECT_KEY` | Monitor | Jira project key (default: `TAF`) |
| `CHECK_INTERVAL_MS` | Monitor | Polling interval in ms (default: `60000`) |

## Key Details

- ES Modules (`"type": "module"` in package.json) — use `.js` extensions in imports
- TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- Target: ES2022, Module resolution: Node16
- AppDynamics base URL is hardcoded to `https://experience.saas.appdynamics.com` (SaaS only)
- Jira integration uses Basic auth (base64-encoded `username:token`)

- always update README.MD when adding new capabilites or fixing bugs
