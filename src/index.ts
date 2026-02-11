import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

// 1. Setup credentials
const APPD_URL = process.env.APPD_URL ;
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
      {
        name: "get_business_transactions",
        description: "Retrieve a list of all business transactions for a given application.",
        inputSchema: {
          type: "object",
          properties: {
            applicationId: {
              type: "number",
              description: "The ID of the application to retrieve business transactions for.",
            },
          },
          required: ["applicationId"],
        },
      },
      {
        name: "get_bt_performance",
        description: "Retrieve performance metrics (average response time, calls per minute, errors per minute) for a specific business transaction.",
        inputSchema: {
          type: "object",
          properties: {
            applicationId: {
              type: "number",
              description: "The ID of the application.",
            },
            btId: {
              type: "number",
              description: "The ID of the business transaction.",
            },
            durationInMins: {
              type: "number",
              description: "Optional: Time range in minutes to look back. Defaults to 60 (last hour).",
            },
          },
          required: ["applicationId", "btId"],
        },
      },
      {
        name: "get_tiers_and_nodes",
        description: "Retrieve the tiers and nodes (infrastructure topology) for a given application.",
        inputSchema: {
          type: "object",
          properties: {
            applicationId: {
              type: "number",
              description: "The ID of the application.",
            },
          },
          required: ["applicationId"],
        },
      },
      {
        name: "get_snapshots",
        description: "Retrieve transaction snapshots (slow, error, stall) for an application. Snapshots provide deep diagnostic details for individual requests.",
        inputSchema: {
          type: "object",
          properties: {
            applicationId: {
              type: "number",
              description: "The ID of the application.",
            },
            durationInMins: {
              type: "number",
              description: "Optional: Time range in minutes to look back. Defaults to 30.",
            },
            guids: {
              type: "string",
              description: "Optional: Comma-separated request GUIDs to retrieve specific snapshots.",
            },
            "data-collector-name": {
              type: "string",
              description: "Optional: Filter by data collector name.",
            },
            "data-collector-type": {
              type: "string",
              description: "Optional: Filter by data collector type.",
            },
            "data-collector-value": {
              type: "string",
              description: "Optional: Filter by data collector value.",
            },
            maxResults: {
              type: "number",
              description: "Optional: Maximum number of snapshots to return. Defaults to 20.",
            },
          },
          required: ["applicationId"],
        },
      },
      {
        name: "get_errors",
        description: "Retrieve error and exception events for an application. Useful for root-cause analysis of failures.",
        inputSchema: {
          type: "object",
          properties: {
            applicationId: {
              type: "number",
              description: "The ID of the application.",
            },
            durationInMins: {
              type: "number",
              description: "Optional: Time range in minutes to look back. Defaults to 60.",
            },
          },
          required: ["applicationId"],
        },
      },
      {
        name: "get_metric_data",
        description: "Retrieve any metric data from AppDynamics using a metric path. This is a generic tool that can query any metric in the AppDynamics metric tree (infrastructure, custom metrics, etc.).",
        inputSchema: {
          type: "object",
          properties: {
            applicationId: {
              type: "number",
              description: "The ID of the application.",
            },
            metricPath: {
              type: "string",
              description: "The metric path to query (e.g. 'Overall Application Performance|Average Response Time (ms)', 'Application Infrastructure Performance|*|Hardware Resources|CPU|%Busy').",
            },
            durationInMins: {
              type: "number",
              description: "Optional: Time range in minutes to look back. Defaults to 60.",
            },
          },
          required: ["applicationId", "metricPath"],
        },
      },
      {
        name: "get_anomalies",
        description: "Retrieve anomaly detection events for a specific application or all applications. Returns events such as anomaly openings, closings, upgrades, and downgrades.",
        inputSchema: {
          type: "object",
          properties: {
            applicationId: {
              type: "number",
              description: "Optional: The ID of the application. If not provided, checks all applications.",
            },
            durationInMins: {
              type: "number",
              description: "Optional: Time range in minutes to look back. Defaults to 1440 (last 24 hours).",
            },
            severities: {
              type: "string",
              description: "Optional: Comma-separated severity levels to include. Defaults to 'INFO,WARN,ERROR'.",
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
            `${APPD_URL}/controller/rest/applications/${applicationId}/problems/healthrule-violations?time-range-type=BEFORE_NOW&duration-in-mins=1440&output=JSON`,
            {
              headers: { 'Authorization': `Bearer ${token}` }
            }
          );
        } catch (error) {
          // If healthrule-violations fails, try the general problems endpoint
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            response = await axios.get(
              `${APPD_URL}/controller/rest/applications/${applicationId}/problems?time-range-type=BEFORE_NOW&duration-in-mins=1440&output=JSON`,
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
        const headers = { 'Authorization': `Bearer ${token}` };

        // Helper to fetch and parse violations for a single app
        async function fetchAppViolations(app: any) {
          try {
            let violationsResponse;
            try {
              violationsResponse = await axios.get(
                `${APPD_URL}/controller/rest/applications/${app.id}/problems/healthrule-violations?time-range-type=BEFORE_NOW&duration-in-mins=1440&output=JSON`,
                { headers }
              );
            } catch (error) {
              if (axios.isAxiosError(error) && error.response?.status === 404) {
                violationsResponse = await axios.get(
                  `${APPD_URL}/controller/rest/applications/${app.id}/problems?time-range-type=BEFORE_NOW&duration-in-mins=1440&output=JSON`,
                  { headers }
                );
              } else {
                throw error;
              }
            }

            let violations = violationsResponse.data;
            if (violations && typeof violations === 'object' && !Array.isArray(violations)) {
              if (violations.healthRuleViolations) {
                violations = violations.healthRuleViolations;
              } else if (violations.violations) {
                violations = violations.violations;
              } else if (violations.data) {
                violations = violations.data;
              } else if (Array.isArray(violations.problems)) {
                violations = violations.problems.filter((p: any) =>
                  p.type === 'HEALTH_RULE_VIOLATION' ||
                  p.triggeredEntityType === 'HEALTH_RULE' ||
                  p.name?.toLowerCase().includes('health')
                );
              }
            }

            const hasViolations = Array.isArray(violations)
              ? violations.length > 0
              : violations && Object.keys(violations).length > 0;

            if (hasViolations) {
              return {
                applicationId: app.id,
                applicationName: app.name,
                violations: Array.isArray(violations) ? violations : [violations]
              };
            }
          } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
              return null;
            }
            console.error(`Error fetching violations for application ${app.id} (${app.name}):`,
              axios.isAxiosError(error) && error.response
                ? `Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`
                : error instanceof Error ? error.message : String(error));
          }
          return null;
        }

        // Fetch violations for all applications in parallel
        const violationResults = await Promise.all(applications.map(fetchAppViolations));
        const allViolations = violationResults.filter((v): v is NonNullable<typeof v> => v !== null);

        return {
          content: [{ type: "text", text: JSON.stringify(allViolations, null, 2) }],
        };
      }
    } catch (error) {
      return handleError(error);
    }
  }

  if (request.params.name === "get_business_transactions") {
    try {
      const token = await getAccessToken();
      const args = request.params.arguments as { applicationId: number };
      const response = await axios.get(
        `${APPD_URL}/controller/rest/applications/${args.applicationId}/business-transactions?output=JSON`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return handleError(error);
    }
  }

  if (request.params.name === "get_bt_performance") {
    try {
      const token = await getAccessToken();
      const args = request.params.arguments as { applicationId: number; btId: number; durationInMins?: number };
      const duration = args.durationInMins || 60;
      const headers = { 'Authorization': `Bearer ${token}` };

      // Get the BT details first to build exact metric paths
      const btListResponse = await axios.get(
        `${APPD_URL}/controller/rest/applications/${args.applicationId}/business-transactions?output=JSON`,
        { headers }
      );

      const bt = btListResponse.data.find((b: any) => b.id === args.btId);
      if (!bt) {
        return {
          content: [{ type: "text", text: `Business transaction with ID ${args.btId} not found.` }],
          isError: true,
        };
      }

      const metricNames = [
        "Average Response Time (ms)",
        "Calls per Minute",
        "Errors per Minute",
        "Number of Slow Calls",
        "Number of Very Slow Calls",
        "Stall Count",
      ];

      // Fetch all metrics in parallel using exact BT path
      const metricPromises = metricNames.map(metric =>
        axios.get(
          `${APPD_URL}/controller/rest/applications/${args.applicationId}/metric-data`,
          {
            params: {
              "metric-path": `Business Transaction Performance|Business Transactions|${bt.tierName}|${bt.name}|${metric}`,
              "time-range-type": "BEFORE_NOW",
              "duration-in-mins": duration,
              "output": "JSON",
            },
            headers
          }
        ).then(response => ({ metric, data: response.data }))
         .catch(() => null)
      );

      const metricResults = await Promise.all(metricPromises);

      const results: Record<string, any> = {
        businessTransaction: {
          id: bt.id,
          name: bt.name,
          tierName: bt.tierName,
          entryPointType: bt.entryPointType,
        },
      };

      for (const result of metricResults) {
        if (result && result.data && result.data.length > 0) {
          results[result.metric] = result.data[0];
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    } catch (error) {
      return handleError(error);
    }
  }

  if (request.params.name === "get_tiers_and_nodes") {
    try {
      const token = await getAccessToken();
      const args = request.params.arguments as { applicationId: number };
      const headers = { 'Authorization': `Bearer ${token}` };

      // Fetch tiers and nodes in parallel
      const [tiersResponse, nodesResponse] = await Promise.all([
        axios.get(
          `${APPD_URL}/controller/rest/applications/${args.applicationId}/tiers?output=JSON`,
          { headers }
        ),
        axios.get(
          `${APPD_URL}/controller/rest/applications/${args.applicationId}/nodes?output=JSON`,
          { headers }
        ),
      ]);

      // Group nodes by tier
      const nodesByTier: Record<number, any[]> = {};
      for (const node of nodesResponse.data) {
        const tierId = node.tierId;
        if (!nodesByTier[tierId]) nodesByTier[tierId] = [];
        nodesByTier[tierId].push(node);
      }

      const result = tiersResponse.data.map((tier: any) => ({
        ...tier,
        nodes: nodesByTier[tier.id] || [],
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return handleError(error);
    }
  }

  if (request.params.name === "get_snapshots") {
    try {
      const token = await getAccessToken();
      const args = request.params.arguments as {
        applicationId: number;
        durationInMins?: number;
        guids?: string;
        "data-collector-name"?: string;
        "data-collector-type"?: string;
        "data-collector-value"?: string;
        maxResults?: number;
      };
      const headers = { 'Authorization': `Bearer ${token}` };
      const duration = args.durationInMins || 30;
      const maxResults = args.maxResults || 20;

      const params: Record<string, any> = {
        "time-range-type": "BEFORE_NOW",
        "duration-in-mins": duration,
        "output": "JSON",
        "maximum-results": maxResults,
      };

      if (args.guids) params["guids"] = args.guids;
      if (args["data-collector-name"]) params["data-collector-name"] = args["data-collector-name"];
      if (args["data-collector-type"]) params["data-collector-type"] = args["data-collector-type"];
      if (args["data-collector-value"]) params["data-collector-value"] = args["data-collector-value"];

      const response = await axios.get(
        `${APPD_URL}/controller/rest/applications/${args.applicationId}/request-snapshots`,
        { params, headers }
      );

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return handleError(error);
    }
  }

  if (request.params.name === "get_errors") {
    try {
      const token = await getAccessToken();
      const args = request.params.arguments as { applicationId: number; durationInMins?: number };
      const duration = args.durationInMins || 60;
      const headers = { 'Authorization': `Bearer ${token}` };

      const response = await axios.get(
        `${APPD_URL}/controller/rest/applications/${args.applicationId}/events`,
        {
          params: {
            "time-range-type": "BEFORE_NOW",
            "duration-in-mins": duration,
            "event-types": "ERROR,APPLICATION_ERROR,APPLICATION_CRASH",
            "severities": "ERROR,WARN",
            "output": "JSON",
          },
          headers,
        }
      );

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return handleError(error);
    }
  }

  if (request.params.name === "get_metric_data") {
    try {
      const token = await getAccessToken();
      const args = request.params.arguments as { applicationId: number; metricPath: string; durationInMins?: number };
      const duration = args.durationInMins || 60;
      const headers = { 'Authorization': `Bearer ${token}` };

      const response = await axios.get(
        `${APPD_URL}/controller/rest/applications/${args.applicationId}/metric-data`,
        {
          params: {
            "metric-path": args.metricPath,
            "time-range-type": "BEFORE_NOW",
            "duration-in-mins": duration,
            "output": "JSON",
          },
          headers,
        }
      );

      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      return handleError(error);
    }
  }

  if (request.params.name === "get_anomalies") {
    try {
      const token = await getAccessToken();
      const args = request.params.arguments as { applicationId?: number; durationInMins?: number; severities?: string } | undefined;
      const duration = args?.durationInMins || 1440;
      const severities = args?.severities || "INFO,WARN,ERROR";
      const eventTypes = "ANOMALY_OPEN_WARNING,ANOMALY_OPEN_CRITICAL,ANOMALY_CLOSE_WARNING,ANOMALY_CLOSE_CRITICAL,ANOMALY_UPGRADED,ANOMALY_DOWNGRADED";
      const headers = { 'Authorization': `Bearer ${token}` };

      async function fetchAnomalies(appId: number) {
        const response = await axios.get(
          `${APPD_URL}/controller/rest/applications/${appId}/events`,
          {
            params: {
              "time-range-type": "BEFORE_NOW",
              "duration-in-mins": duration,
              "event-types": eventTypes,
              "severities": severities,
              "output": "JSON",
            },
            headers,
          }
        );
        return response.data;
      }

      if (args?.applicationId) {
        const anomalies = await fetchAnomalies(args.applicationId);
        return {
          content: [{ type: "text", text: JSON.stringify(anomalies, null, 2) }],
        };
      } else {
        // Fetch all apps, then anomalies in parallel
        const appsResponse = await axios.get(`${APPD_URL}/controller/rest/applications?output=JSON`, { headers });
        const applications = appsResponse.data;

        const results = await Promise.all(
          applications.map(async (app: any) => {
            try {
              const anomalies = await fetchAnomalies(app.id);
              const events = Array.isArray(anomalies) ? anomalies : [];
              if (events.length > 0) {
                return { applicationId: app.id, applicationName: app.name, anomalies: events };
              }
            } catch (error) {
              if (!(axios.isAxiosError(error) && error.response?.status === 404)) {
                console.error(`Error fetching anomalies for application ${app.id} (${app.name}):`,
                  error instanceof Error ? error.message : String(error));
              }
            }
            return null;
          })
        );

        const allAnomalies = results.filter((r): r is NonNullable<typeof r> => r !== null);
        return {
          content: [{ type: "text", text: JSON.stringify(allAnomalies, null, 2) }],
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