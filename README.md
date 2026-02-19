# AppDynamics MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives LLM clients (Cursor, Claude Desktop, etc.) full access to your AppDynamics monitoring data — plus the ability to create and manage dashboards.

## Features

**19 tools** across 6 categories:

- **Discovery**: List and search applications by name
- **Health Monitoring**: Health rules, violations, and anomaly detection
- **Application Performance**: Business transactions, service endpoints, and their metrics
- **Infrastructure**: Tiers, nodes, and backend/remote service dependencies
- **Diagnostics**: Transaction snapshots and error events
- **Metrics**: Browse the metric tree and query any metric
- **Dashboards**: Full CRUD — list, view, create, update, add widgets, clone, delete, export

### Key capabilities

- **Natural language friendly**: Accept application names, not just IDs
- **Metric tree browser**: Discover available metrics interactively
- **Dashboard builder**: Create dashboards from natural language descriptions
- **Smart defaults**: Sensible time ranges and result limits out of the box

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|---|---|
| `APPD_URL` | Controller base URL (e.g., `https://mycompany.saas.appdynamics.com`) |
| `APPD_CLIENT_NAME` | OAuth client name or API key |
| `APPD_CLIENT_SECRET` | OAuth client secret |
| `APPD_ACCOUNT_NAME` | Account name (for `clientName@accountName` format) |

### 3. Add to your MCP client

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "appdynamics": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/appdynamics-mcp-server",
      "env": {
        "APPD_URL": "https://your-controller.saas.appdynamics.com",
        "APPD_CLIENT_NAME": "your-client-name",
        "APPD_CLIENT_SECRET": "your-client-secret",
        "APPD_ACCOUNT_NAME": "your-account-name"
      }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "appdynamics": {
      "command": "npx",
      "args": ["tsx", "/path/to/appdynamics-mcp-server/src/index.ts"],
      "env": {
        "APPD_URL": "https://your-controller.saas.appdynamics.com",
        "APPD_CLIENT_NAME": "your-client-name",
        "APPD_CLIENT_SECRET": "your-client-secret",
        "APPD_ACCOUNT_NAME": "your-account-name"
      }
    }
  }
}
```

## Tools Reference

### Discovery

| Tool | Description |
|---|---|
| `appd_get_applications` | List all monitored applications (with optional name filter) |

### Health Monitoring

| Tool | Description |
|---|---|
| `appd_get_health_rules` | List health rules or get details of a specific rule |
| `appd_get_health_violations` | Get health rule violations for one or all apps |
| `appd_get_anomalies` | Get anomaly events (open-only by default) |

### Application Performance

| Tool | Description |
|---|---|
| `appd_get_business_transactions` | List BTs for an application |
| `appd_get_bt_performance` | Get response time, throughput, errors for a BT |
| `appd_get_service_endpoints` | List service endpoints (API-level granularity) |
| `appd_get_service_endpoint_performance` | Get performance metrics for a service endpoint |

### Infrastructure

| Tool | Description |
|---|---|
| `appd_get_tiers_and_nodes` | Get tiers with their nodes (agents, machines, IPs) |
| `appd_get_backends` | List backend dependencies (databases, APIs, caches, queues) |

### Diagnostics

| Tool | Description |
|---|---|
| `appd_get_snapshots` | Get transaction snapshots (deep diagnostic captures) |
| `appd_get_errors` | Get error and exception events |

### Metrics

| Tool | Description |
|---|---|
| `appd_browse_metric_tree` | Browse the metric hierarchy to discover available metrics |
| `appd_get_metric_data` | Query any metric by path |

### Dashboards

| Tool | Description |
|---|---|
| `appd_get_dashboards` | List all custom dashboards |
| `appd_get_dashboard` | Get full dashboard definition with widgets |
| `appd_create_dashboard` | Create a new dashboard with optional widgets |
| `appd_update_dashboard` | Update dashboard properties and/or widgets |
| `appd_add_widget_to_dashboard` | Add a single widget without replacing existing ones |
| `appd_clone_dashboard` | Clone a dashboard with a new name |
| `appd_delete_dashboard` | Delete a dashboard (permanent) |
| `appd_export_dashboard` | Export dashboard as portable JSON |

## Example Conversations

**"What's the health status of my production apps?"**
→ Uses `appd_get_applications` + `appd_get_health_violations` + `appd_get_anomalies`

**"Show me the slowest business transactions for the Orders app"**
→ Uses `appd_get_business_transactions` + `appd_get_bt_performance`

**"What databases does the Payment service connect to?"**
→ Uses `appd_get_backends` with typeFilter="JDBC"

**"Create a dashboard for the Checkout app with response time and error rate"**
→ Uses `appd_get_applications` → `appd_browse_metric_tree` → `appd_create_dashboard`

**"Clone the production monitoring dashboard for staging"**
→ Uses `appd_get_dashboards` → `appd_clone_dashboard`

## Architecture

```
src/
├── index.ts              # Entry point, registers all tools
├── types.ts              # TypeScript interfaces
├── constants.ts          # Shared constants
├── services/
│   ├── auth.ts           # OAuth2 token management
│   └── api-client.ts     # Authenticated HTTP client
├── utils/
│   ├── error-handler.ts  # Error → MCP response
│   ├── app-resolver.ts   # App name → ID resolution
│   └── formatting.ts     # Response formatting
└── tools/                # One file per tool domain
    ├── applications.ts
    ├── health-rules.ts
    ├── health-violations.ts
    ├── anomalies.ts
    ├── business-transactions.ts
    ├── bt-performance.ts
    ├── service-endpoints.ts
    ├── tiers-nodes.ts
    ├── backends.ts
    ├── snapshots.ts
    ├── errors.ts
    ├── metrics.ts
    └── dashboards.ts
```

## Development

```bash
# Run in dev mode (auto-reload)
npm run dev

# Build TypeScript
npm run build

# Run built version
npm start
```

## Authentication

The server supports two authentication modes:

1. **OAuth2 Client Credentials** (recommended): Set `APPD_CLIENT_NAME`, `APPD_CLIENT_SECRET`, and optionally `APPD_ACCOUNT_NAME`. The server acquires and caches tokens automatically.

2. **API Key**: Set only `APPD_CLIENT_NAME` (as the API key). No secret needed.

## License

ISC
