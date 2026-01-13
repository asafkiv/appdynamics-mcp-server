# AppDynamics MCP Server

A Model Context Protocol (MCP) server that provides access to AppDynamics SaaS REST API, allowing you to query and interact with your AppDynamics instance through MCP-compatible clients like Cursor.

## Features

- **OAuth2 Authentication**: Secure authentication using AppDynamics OAuth2 client credentials
- **Token Caching**: Automatic token caching to minimize authentication requests
- **Application Management**: Retrieve lists of all monitored applications in your AppDynamics instance

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

## Usage

Once configured, you can use the MCP server in Cursor or other MCP-compatible clients:

1. Restart Cursor to load the MCP server configuration
2. The server will automatically authenticate using OAuth2
3. Use the available tools through the MCP interface

### Example Query

Ask Cursor: "Which applications are currently being monitored in our AppDynamics instance?"

The MCP server will:
1. Authenticate with AppDynamics using OAuth2
2. Retrieve the list of applications
3. Return the results in a structured format

## Development

### Project Structure

```
appd-mcp-server/
├── src/
│   └── index.ts          # Main MCP server implementation
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
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
1. Verify the AppDynamics URL is correct (default: `https://experience.saas.appdynamics.com`)
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

