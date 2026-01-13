import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

// 1. Setup credentials
const APPD_URL = "https://experience.saas.appdynamics.com"; 
const APPD_CLIENT_NAME = process.env.APPD_CLIENT_NAME; // API Client Name (key name)
const APPD_CLIENT_SECRET = process.env.APPD_CLIENT_SECRET; // API Client Secret (long string)

const server = new Server(
  { name: "appdynamics-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// 2. Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_applications",
        description: "Retrieve a list of all business applications from AppDynamics",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };
});

// Helper function to get OAuth token
async function getOAuthToken(): Promise<string> {
  if (!APPD_CLIENT_NAME || !APPD_CLIENT_SECRET) {
    throw new Error("APPD_CLIENT_NAME and APPD_CLIENT_SECRET must be set");
  }

  // Create Basic Auth header: base64(client_name:client_secret)
  const credentials = Buffer.from(`${APPD_CLIENT_NAME}:${APPD_CLIENT_SECRET}`).toString('base64');
  
  const response = await axios.post(
    `${APPD_URL}/controller/api/oauth/access_token`,
    'grant_type=client_credentials',
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  return response.data.access_token;
}

// 3. Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_applications") {
    try {
      // First, get OAuth token using client credentials
      const accessToken = await getOAuthToken();

      // Then use the token to make the API call
      const response = await axios.get(`${APPD_URL}/controller/rest/applications?output=JSON`, {
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const statusCode = axios.isAxiosError(error) ? error.response?.status : 'unknown';
      const errorDetails = axios.isAxiosError(error) ? JSON.stringify(error.response?.data) : '';
      
      return {
        content: [{ 
          type: "text", 
          text: `Error (${statusCode}): ${errorMessage}${errorDetails ? '\nDetails: ' + errorDetails : ''}` 
        }],
        isError: true,
      };
    }
  }
  throw new Error("Tool not found");
});

// 4. Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);