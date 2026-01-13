# AppDynamics MCP Server

A Model Context Protocol (MCP) server for integrating AppDynamics monitoring data with AI assistants like Cursor.

## Features

- Retrieve a list of all business applications monitored in your AppDynamics SaaS instance
- OAuth 2.0 authentication with AppDynamics REST API
- TypeScript implementation with full type safety

## Prerequisites

- Node.js 18+ 
- AppDynamics SaaS account with API access
- AppDynamics API Client credentials (Client Name and Client Secret)

## Installation

1. Clone this repository:
```bash
git clone <repository-url>
cd appd-mcp-server
```

2. Install dependencies:
```bash
npm install
```

## Configuration

### Setting up in Cursor

Add the following configuration to your Cursor MCP settings file (typically located at `~/.cursor/mcp.json` or `%APPDATA%\Cursor\mcp.json` on Windows):

```json
{
  "mcpServers": {
    "appdynamics": {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "path/to/appd-mcp-server/src/index.ts"
      ],
      "env": {
        "APPD_CLIENT_NAME": "your-client-name",
        "APPD_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

### Getting AppDynamics API Credentials

1. Log in to your AppDynamics Controller UI
2. Navigate to **Settings** → **API Clients**
3. Create a new API Client or use an existing one
4. Copy the **Client Name** and **Client Secret**

**Important:** Never commit your API credentials to version control. Always use environment variables or secure configuration files.

## Usage

Once configured, you can interact with AppDynamics through your AI assistant:

- "Which applications are currently being monitored in our AppDynamics instance?"
- "Get me a list of all applications from AppDynamics"

## Available Tools

### `get_applications`

Retrieves a list of all business applications from your AppDynamics instance.

**Parameters:** None

**Returns:** JSON array of application objects with details such as:
- Application ID
- Application name
- Health status
- Performance metrics

## Development

### Project Structure

```
appd-mcp-server/
├── src/
│   └── index.ts          # Main MCP server implementation
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md            # This file
```

### Building

The project uses TypeScript with ES modules. To build:

```bash
npm run build
```

### Running Locally

You can test the server locally:

```bash
npx tsx src/index.ts
```

## Authentication

This server uses OAuth 2.0 client credentials flow:

1. Uses Basic Authentication (base64 encoded `client_name:client_secret`) to obtain an OAuth token
2. Uses the OAuth token for subsequent REST API calls

## API Endpoints

The server interacts with the following AppDynamics REST API endpoints:

- `POST /controller/api/oauth/access_token` - Obtain OAuth token
- `GET /controller/rest/applications` - Retrieve applications list

## Error Handling

The server provides detailed error messages including:
- HTTP status codes
- Error messages from the API
- Authentication failures with helpful guidance

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues related to:
- **This MCP server**: Open an issue in this repository
- **AppDynamics API**: Consult [AppDynamics Documentation](https://docs.appdynamics.com/)
- **MCP Protocol**: See [Model Context Protocol Documentation](https://modelcontextprotocol.io/)

