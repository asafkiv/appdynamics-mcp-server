# AppDynamics MCP Server

A Model Context Protocol (MCP) server that provides access to AppDynamics SaaS REST API, allowing you to query and interact with your AppDynamics instance through MCP-compatible clients like Cursor.

## Features

- **OAuth2 Authentication**: Secure authentication using AppDynamics OAuth2 client credentials
- **Token Caching**: Automatic token caching to minimize authentication requests
- **Application Management**: Retrieve lists of all monitored applications in your AppDynamics instance
- **Business Transactions**: Query business transactions and their performance metrics
- **Health Violations**: Monitor health rule violations across applications
- **Anomaly Detection**: Query anomaly detection events across applications

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- AppDynamics SaaS account with API client credentials

## Installation

1. Clone the repository:
```bash
git clone https://github.com/asafkiv/appdynamics-mcp-server.git
cd appdynamics-mcp-server
```

2. Install dependencies:
```bash
npm install
```

## Configuration

### AppDynamics API Client Setup

1. Log in to your AppDynamics Controller UI
2. Navigate to **Settings** → **API Clients**
3. Create a new API Client with the following:
   - **Client Name**: Your chosen client name (e.g., `mcpV2`)
   - **Client Secret**: Generated secret (save this securely)
   - **Account Name**: Your AppDynamics account name (if required)

### MCP Configuration (Cursor)

Add the following configuration to your Cursor MCP settings file (typically `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "appdynamics": {
      "command": "C:\\TEMP\\AppD-MCP\\appd-mcp-server\\node_modules\\.bin\\tsx.cmd",
      "args": [
        "C:\\TEMP\\AppD-MCP\\appd-mcp-server\\src\\index.ts"
      ],
      "env": {
        "APPD_URL": "https://your-account.saas.appdynamics.com",
        "APPD_CLIENT_NAME": "your_client_name",
        "APPD_CLIENT_SECRET": "your_client_secret",
        "APPD_ACCOUNT_NAME": "your_account_name"
      }
    }
  }
}
```

**Note**:
- Update the `command` path to match your installation directory
- Replace `APPD_URL` with your AppDynamics controller URL (e.g., `https://your-account.saas.appdynamics.com`)
- Replace `your_client_name`, `your_client_secret`, and `your_account_name` with your actual AppDynamics credentials
- The `APPD_ACCOUNT_NAME` is optional if your client ID doesn't require the `clientName@accountName` format

### Alternative: API Key Authentication

If you prefer to use an API key directly (not recommended for production), you can use:

```json
{
  "env": {
    "APPD_API_KEY": "your_api_key"
  }
}
```

## Available Tools

### `get_applications`

Retrieves a list of all business applications currently being monitored in your AppDynamics SaaS instance.

**Parameters**: None

**Returns**: JSON array of applications with the following structure:
```json
[
  {
    "name": "Application Name",
    "id": 12345,
    "accountGuid": "guid-string",
    "description": "Optional description"
  }
]
```

### `get_health_violations`

Retrieves health rule violations for a specific application or all applications in your AppDynamics instance.

**Parameters**:
- `applicationId` (optional, number): The ID of the application to check for health violations. If not provided, checks all applications.

**Returns**: 
- If `applicationId` is provided: JSON array of health rule violations for that application
- If `applicationId` is not provided: JSON array of objects containing violations grouped by application:
```json
[
  {
    "applicationId": 12345,
    "applicationName": "Application Name",
    "violations": [
      {
        "id": 67890,
        "name": "Health Rule Name",
        "severity": "WARN|ERROR|CRITICAL",
        "affectedEntityType": "APPLICATION_COMPONENT_NODE",
        "detectedTimeInMillis": 1234567890,
        "summary": "Violation summary"
      }
    ]
  }
]
```

**Example Usage**:
- Get violations for a specific application: `get_health_violations` with `applicationId: 12345`
- Get violations for all applications: `get_health_violations` with no parameters

### `get_business_transactions`

Retrieves a list of all business transactions for a given application.

**Parameters**:
- `applicationId` (required, number): The ID of the application to retrieve business transactions for.

**Returns**: JSON array of business transactions with details such as name, tier, entry point type, and ID.

**Example Usage**:
- Get all BTs for an application: `get_business_transactions` with `applicationId: 12345`

### `get_bt_performance`

Retrieves performance metrics for a specific business transaction.

**Parameters**:
- `applicationId` (required, number): The ID of the application.
- `btId` (required, number): The ID of the business transaction.
- `durationInMins` (optional, number): Time range in minutes to look back. Defaults to 60 (last hour).

**Returns**: JSON object containing the following metrics:
- Average Response Time (ms)
- Calls per Minute
- Errors per Minute
- Number of Slow Calls
- Number of Very Slow Calls
- Stall Count

**Example Usage**:
- Get last hour performance: `get_bt_performance` with `applicationId: 12345, btId: 67890`
- Get last 24h performance: `get_bt_performance` with `applicationId: 12345, btId: 67890, durationInMins: 1440`

### `get_anomalies`

Retrieves anomaly detection events for a specific application or all applications.

**Parameters**:
- `applicationId` (optional, number): The ID of the application. If not provided, checks all applications.
- `durationInMins` (optional, number): Time range in minutes to look back. Defaults to 1440 (last 24 hours).
- `severities` (optional, string): Comma-separated severity levels to include. Defaults to `INFO,WARN,ERROR`.

**Returns**: Anomaly events including openings, closings, upgrades, and downgrades. When querying all applications, results are grouped by application:
```json
[
  {
    "applicationId": 12345,
    "applicationName": "Application Name",
    "anomalies": [
      {
        "id": 67890,
        "type": "ANOMALY_OPEN_CRITICAL",
        "severity": "ERROR",
        "summary": "Anomaly summary",
        "eventTime": 1234567890
      }
    ]
  }
]
```

**Example Usage**:
- Get anomalies for a specific application: `get_anomalies` with `applicationId: 12345`
- Get anomalies across all applications: `get_anomalies` with no parameters
- Get last 4 hours of critical anomalies: `get_anomalies` with `applicationId: 12345, durationInMins: 240, severities: "ERROR"`

## Usage

Once configured, you can use the MCP server in Cursor or other MCP-compatible clients:

1. Restart Cursor to load the MCP server configuration
2. The server will automatically authenticate using OAuth2
3. Use the available tools through the MCP interface

### Example Queries

**Get all applications:**
Ask Cursor: "Which applications are currently being monitored in our AppDynamics instance?"

**Check health violations:**
Ask Cursor: "Are there any health rule violations in our AppDynamics instance?"
or
Ask Cursor: "Check for health violations in application ID 12345"

**List business transactions:**
Ask Cursor: "What business transactions exist in application 12345?"

**Check BT performance:**
Ask Cursor: "Show me the performance metrics for business transaction 67890 in application 12345"
or
Ask Cursor: "How is the response time for BT 67890 over the last 24 hours?"

**Check anomalies:**
Ask Cursor: "Are there any anomalies detected across our applications?"
or
Ask Cursor: "Show me anomalies for application 12345 in the last 4 hours"

The MCP server will:
1. Authenticate with AppDynamics using OAuth2
2. Execute the requested query
3. Return the results in a structured format

## Development

### Project Structure

```
appd-mcp-server/
├── src/
│   └── index.ts          # Main MCP server implementation
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── CLAUDE.md             # Claude Code onboarding guide
└── README.md             # This file
```

### Building

The project uses TypeScript with `tsx` for direct execution. No build step is required for development.

### TypeScript Configuration

The project is configured with:
- **Module System**: ES Modules (`"type": "module"`)
- **Target**: ES2022
- **Module Resolution**: Node16
- **Strict Mode**: Enabled

## Authentication Flow

1. The server checks for cached OAuth token
2. If no valid token exists, it requests a new token using:
   - Client credentials grant type
   - Client ID (optionally formatted as `clientName@accountName`)
   - Client secret
3. Token is cached until near expiry (5 minutes before)
4. All API requests use the Bearer token for authentication

## Error Handling

The server provides detailed error messages for:
- Authentication failures
- API request errors
- Missing configuration
- Network issues

## Security Notes

- **Never commit** your `APPD_CLIENT_SECRET` or API keys to version control
- Store credentials securely in environment variables or secure configuration files
- Rotate API client credentials regularly
- Use the minimum required permissions for your API client

## Troubleshooting

### Authentication Errors

If you encounter `401 Unauthorized` errors:
1. Verify your `APPD_CLIENT_NAME` and `APPD_CLIENT_SECRET` are correct
2. Check if your API client has the required permissions
3. Ensure your account name is correct if using the `clientName@accountName` format

### Connection Issues

If the server fails to connect:
1. Verify the `APPD_URL` environment variable is set to your correct controller URL (e.g., `https://your-account.saas.appdynamics.com`)
2. Check your network connectivity
3. Verify firewall settings allow outbound HTTPS connections

### MCP Server Not Loading

If Cursor doesn't recognize the MCP server:
1. Verify the path in `mcp.json` is correct
2. Ensure `tsx` is installed (`npm install`)
3. Restart Cursor completely
4. Check Cursor's MCP server logs for errors

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues related to:
- **AppDynamics API**: Consult [AppDynamics Documentation](https://docs.appdynamics.com/)
- **MCP Protocol**: See [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
- **This Project**: Open an issue on GitHub

