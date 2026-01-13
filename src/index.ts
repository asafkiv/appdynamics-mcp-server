import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

// 1. Setup credentials
const APPD_URL = "https://experience.saas.appdynamics.com"; 
const CLIENT_NAME = process.env.APPD_CLIENT_NAME || process.env.APPD_API_KEY; // Client name or API key
const CLIENT_SECRET = process.env.APPD_CLIENT_SECRET;
const ACCOUNT_NAME = process.env.APPD_ACCOUNT_NAME; // Optional account name for client_id format

// Cache for OAuth token
let accessToken: string | null = null;
let tokenExpiry: number = 0;

// Function to get OAuth access token
async function getAccessToken(): Promise<string> {
  // Debug: Check if credentials are available
  if (!CLIENT_NAME || !CLIENT_SECRET) {
    console.error(`Missing credentials - CLIENT_NAME: ${CLIENT_NAME ? 'set' : 'missing'}, CLIENT_SECRET: ${CLIENT_SECRET ? 'set' : 'missing'}`);
  }
  
  // If we have a valid cached token, return it
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  // Try OAuth2 client credentials flow first
  if (CLIENT_NAME && CLIENT_SECRET) {
    try {
      // Format client_id as <clientName>@<accountName> if account name is provided
      const clientId = ACCOUNT_NAME ? `${CLIENT_NAME}@${ACCOUNT_NAME}` : CLIENT_NAME;
      
      const response = await axios.post(
        `${APPD_URL}/controller/api/oauth/access_token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: CLIENT_SECRET
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
      
      const token = response.data.access_token;
      if (!token) {
        throw new Error('No access token received from OAuth endpoint');
      }
      accessToken = token;
      // Set expiry to 5 minutes before actual expiry for safety
      tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;
      return token;
    } catch (error) {
      // Log OAuth error for debugging
      if (axios.isAxiosError(error)) {
        const errorDetails = error.response 
          ? `Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`
          : error.message;
        console.error(`OAuth authentication failed: ${errorDetails}`);
      }
      // If OAuth fails, fall through to API key method
    }
  }

  // Fallback: use API key directly if OAuth not configured
  if (CLIENT_NAME && !CLIENT_SECRET) {
    return CLIENT_NAME;
  }

  throw new Error('AppDynamics authentication not configured. Please set APPD_CLIENT_NAME and APPD_CLIENT_SECRET, or APPD_API_KEY.');
}

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
      {
        name: "get_health_violations",
        description: "Retrieve health rule violations for a specific application or all applications. If applicationId is not provided, returns violations for all applications.",
        inputSchema: {
          type: "object",
          properties: {
            applicationId: {
              type: "number",
              description: "Optional: The ID of the application to check for health violations. If not provided, checks all applications.",
            },
          },
        },
      },
    ],
  };
});

// Helper function to handle errors
function handleError(error: unknown): { content: Array<{ type: string; text: string }>; isError: boolean } {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (axios.isAxiosError(error)) {
    const details = error.response 
      ? `Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`
      : error.message;
    return {
      content: [{ type: "text", text: `Error: ${details}` }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: `Error: ${errorMessage}` }],
    isError: true,
  };
}

// 3. Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_applications") {
    try {
      const token = await getAccessToken();
      const response = await axios.get(`${APPD_URL}/controller/rest/applications?output=JSON`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return handleError(error);
    }
  }

  if (request.params.name === "get_health_violations") {
    try {
      const token = await getAccessToken();
      // Access arguments safely - MCP SDK passes arguments in params.arguments
      const args = request.params.arguments as { applicationId?: number } | undefined;
      const applicationId = args?.applicationId;

      if (applicationId) {
        // Get violations for a specific application
        let response;
        try {
          response = await axios.get(
            `${APPD_URL}/controller/rest/applications/${applicationId}/problems/healthrule-violations?output=JSON`,
            {
              headers: { 'Authorization': `Bearer ${token}` }
            }
          );
        } catch (error) {
          // If healthrule-violations fails, try the general problems endpoint
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            response = await axios.get(
              `${APPD_URL}/controller/rest/applications/${applicationId}/problems?output=JSON`,
              {
                headers: { 'Authorization': `Bearer ${token}` }
              }
            );
          } else {
            throw error;
          }
        }

        // Handle different response formats
        let violations = response.data;
        if (violations && typeof violations === 'object' && !Array.isArray(violations)) {
          if (violations.healthRuleViolations) {
            violations = violations.healthRuleViolations;
          } else if (violations.violations) {
            violations = violations.violations;
          } else if (violations.data) {
            violations = violations.data;
          }
          // If it's a problems array, filter for health rule violations
          else if (Array.isArray(violations.problems)) {
            violations = violations.problems.filter((p: any) => 
              p.type === 'HEALTH_RULE_VIOLATION' || 
              p.triggeredEntityType === 'HEALTH_RULE' ||
              p.name?.toLowerCase().includes('health')
            );
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(violations, null, 2) }],
        };
      } else {
        // Get violations for all applications
        // First, get all applications
        const appsResponse = await axios.get(`${APPD_URL}/controller/rest/applications?output=JSON`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        const applications = appsResponse.data;
        const allViolations: Array<{ applicationId: number; applicationName: string; violations: any }> = [];

        // Fetch violations for each application
        for (const app of applications) {
          try {
            // Try the healthrule-violations endpoint first
            let violationsResponse;
            try {
              violationsResponse = await axios.get(
                `${APPD_URL}/controller/rest/applications/${app.id}/problems/healthrule-violations?output=JSON`,
                {
                  headers: { 'Authorization': `Bearer ${token}` }
                }
              );
            } catch (error) {
              // If healthrule-violations fails, try the general problems endpoint
              if (axios.isAxiosError(error) && error.response?.status === 404) {
                violationsResponse = await axios.get(
                  `${APPD_URL}/controller/rest/applications/${app.id}/problems?output=JSON`,
                  {
                    headers: { 'Authorization': `Bearer ${token}` }
                  }
                );
              } else {
                throw error;
              }
            }

            // Handle different response formats
            let violations = violationsResponse.data;
            
            // If response is an object, check for common property names
            if (violations && typeof violations === 'object' && !Array.isArray(violations)) {
              // Check for nested arrays or objects
              if (violations.healthRuleViolations) {
                violations = violations.healthRuleViolations;
              } else if (violations.violations) {
                violations = violations.violations;
              } else if (violations.data) {
                violations = violations.data;
              }
              // If it's a problems array, filter for health rule violations
              else if (Array.isArray(violations.problems)) {
                violations = violations.problems.filter((p: any) => 
                  p.type === 'HEALTH_RULE_VIOLATION' || 
                  p.triggeredEntityType === 'HEALTH_RULE' ||
                  p.name?.toLowerCase().includes('health')
                );
              }
            }

            // Check if we have violations (array with items or non-empty object)
            const hasViolations = Array.isArray(violations) 
              ? violations.length > 0 
              : violations && Object.keys(violations).length > 0;

            if (hasViolations) {
              allViolations.push({
                applicationId: app.id,
                applicationName: app.name,
                violations: Array.isArray(violations) ? violations : [violations]
              });
            }
          } catch (error) {
            // Log but continue with other applications
            if (axios.isAxiosError(error) && error.response?.status === 404) {
              // 404 means no violations endpoint or no violations - this is normal
              continue;
            }
            console.error(`Error fetching violations for application ${app.id} (${app.name}):`, 
              axios.isAxiosError(error) && error.response 
                ? `Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`
                : error instanceof Error ? error.message : String(error));
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(allViolations, null, 2) }],
        };
      }
    } catch (error) {
      return handleError(error);
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