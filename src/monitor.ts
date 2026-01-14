import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Configuration
const APPD_URL = "https://experience.saas.appdynamics.com";
const CLIENT_NAME = process.env.APPD_CLIENT_NAME || process.env.APPD_API_KEY;
const CLIENT_SECRET = process.env.APPD_CLIENT_SECRET;
const ACCOUNT_NAME = process.env.APPD_ACCOUNT_NAME;

// Jira configuration
const JIRA_URL = process.env.JIRA_URL || "https://matrixdevops.atlassian.net";
const JIRA_USERNAME = process.env.JIRA_USERNAME || "asafk@matrix.co.il";
const JIRA_TOKEN = process.env.JIRA_TOKEN || "";
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || "TAF";

// Monitoring configuration
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || "60000"); // Default: 1 minute
const STATE_FILE = path.join(process.cwd(), "violations-state.json");

// State management: Map of incident ID -> Jira ticket key
interface ViolationState {
  [incidentId: string]: {
    jiraKey: string;
    status: string; // OPEN, CANCELLED
    lastChecked: number;
  };
}

let violationState: ViolationState = {};

// Load state from file
function loadState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, "utf-8");
      violationState = JSON.parse(data);
      console.log(`Loaded state with ${Object.keys(violationState).length} tracked violations`);
    }
  } catch (error) {
    console.error("Error loading state:", error);
    violationState = {};
  }
}

// Save state to file
function saveState(): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(violationState, null, 2));
  } catch (error) {
    console.error("Error saving state:", error);
  }
}

// OAuth token cache
let accessToken: string | null = null;
let tokenExpiry: number = 0;

async function getAppDAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  if (CLIENT_NAME && CLIENT_SECRET) {
    try {
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
      tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;
      return token;
    } catch (error) {
      console.error("OAuth authentication failed:", error);
      throw error;
    }
  }

  if (CLIENT_NAME && !CLIENT_SECRET) {
    return CLIENT_NAME;
  }

  throw new Error('AppDynamics authentication not configured');
}

async function getHealthViolations(): Promise<Array<{ applicationId: number; applicationName: string; violations: any[] }>> {
  const token = await getAppDAccessToken();
  const appsResponse = await axios.get(`${APPD_URL}/controller/rest/applications?output=JSON`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const applications = appsResponse.data;
  const allViolations: Array<{ applicationId: number; applicationName: string; violations: any[] }> = [];

  for (const app of applications) {
    try {
      let violationsResponse;
      try {
        violationsResponse = await axios.get(
          `${APPD_URL}/controller/rest/applications/${app.id}/problems/healthrule-violations?time-range-type=BEFORE_NOW&duration-in-mins=1440&output=JSON`,
          {
            headers: { 'Authorization': `Bearer ${token}` }
          }
        );
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          violationsResponse = await axios.get(
            `${APPD_URL}/controller/rest/applications/${app.id}/problems?time-range-type=BEFORE_NOW&duration-in-mins=1440&output=JSON`,
            {
              headers: { 'Authorization': `Bearer ${token}` }
            }
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
        allViolations.push({
          applicationId: app.id,
          applicationName: app.name,
          violations: Array.isArray(violations) ? violations : [violations]
        });
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        continue;
      }
      console.error(`Error fetching violations for application ${app.id}:`, error);
    }
  }

  return allViolations;
}

async function createJiraTicket(violation: any, applicationName: string): Promise<string | null> {
  if (!JIRA_TOKEN) {
    console.error("JIRA_TOKEN not configured");
    return null;
  }

  try {
    const summary = `AppDynamics Health Rule Violation: ${violation.affectedEntityDefinition?.name || 'Unknown'} - ${violation.severity} Response Time Exceeded`;
    
    const description = `## AppDynamics Health Rule Violation

**Application:** ${applicationName} (ID: ${violation.affectedEntityDefinition?.entityId || 'N/A'})
**Severity:** ${violation.severity}
**Status:** ${violation.incidentStatus}
**Policy:** ${violation.triggeredEntityDefinition?.name || 'N/A'}
**Incident ID:** ${violation.id}

### Violation Details
- **Business Transaction:** ${violation.affectedEntityDefinition?.name || 'Unknown'}
- **Issue:** Average Response Time exceeded threshold
- **Description:** ${violation.description?.replace(/<[^>]*>/g, '') || 'N/A'}

### View in AppDynamics
[View Violation Details](${violation.deepLinkUrl})`;

    const priority = violation.severity === 'CRITICAL' ? 'Critical' : 'High';

    const response = await axios.post(
      `${JIRA_URL}/rest/api/2/issue`,
      {
        fields: {
          project: { key: JIRA_PROJECT_KEY },
          summary: summary,
          description: description,
          issuetype: { name: "Task" },
          priority: { name: priority }
        }
      },
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_TOKEN}`).toString('base64')}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.key;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`Error creating Jira ticket for incident ${violation.id}:`, 
        error.response?.status, error.response?.data);
    } else {
      console.error(`Error creating Jira ticket for incident ${violation.id}:`, error);
    }
    return null;
  }
}

async function updateJiraTicketStatus(jiraKey: string, status: string): Promise<boolean> {
  if (!JIRA_TOKEN) {
    return false;
  }

  try {
    // Get available transitions for the issue
    const transitionsResponse = await axios.get(
      `${JIRA_URL}/rest/api/2/issue/${jiraKey}/transitions`,
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_TOKEN}`).toString('base64')}`
        }
      }
    );

    // Find the "Done" transition
    const doneTransition = transitionsResponse.data.transitions.find((t: any) => 
      t.name.toLowerCase() === 'done' || t.to.name.toLowerCase() === 'done'
    );

    if (!doneTransition) {
      console.log(`No "Done" transition found for ${jiraKey}`);
      return false;
    }

    // Transition to Done
    await axios.post(
      `${JIRA_URL}/rest/api/2/issue/${jiraKey}/transitions`,
      {
        transition: { id: doneTransition.id }
      },
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_TOKEN}`).toString('base64')}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`Updated ${jiraKey} to Done`);
    return true;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`Error updating Jira ticket ${jiraKey}:`, 
        error.response?.status, error.response?.data);
    } else {
      console.error(`Error updating Jira ticket ${jiraKey}:`, error);
    }
    return false;
  }
}

async function checkAndProcessViolations(): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] Checking for health violations...`);
    
    const allViolations = await getHealthViolations();
    const currentViolations = new Set<string>();

    // Process all violations
    for (const appViolations of allViolations) {
      for (const violation of appViolations.violations) {
        const incidentId = String(violation.id);
        currentViolations.add(incidentId);

        // Check if this is a new violation
        if (!violationState[incidentId]) {
          console.log(`New violation detected: Incident ${incidentId} - ${violation.affectedEntityDefinition?.name}`);
          const jiraKey = await createJiraTicket(violation, appViolations.applicationName);
          
          if (jiraKey) {
            violationState[incidentId] = {
              jiraKey: jiraKey,
              status: violation.incidentStatus,
              lastChecked: Date.now()
            };
            console.log(`Created Jira ticket ${jiraKey} for incident ${incidentId}`);
            saveState();
          }
        } else {
          // Update existing violation status
          const state = violationState[incidentId];
          
          // If violation was OPEN and now is CANCELLED, update Jira ticket
          if (state.status === 'OPEN' && violation.incidentStatus === 'CANCELLED') {
            console.log(`Violation ${incidentId} closed, updating Jira ticket ${state.jiraKey} to Done`);
            await updateJiraTicketStatus(state.jiraKey, 'Done');
            state.status = 'CANCELLED';
            saveState();
          } else if (state.status !== violation.incidentStatus) {
            // Status changed, update our state
            state.status = violation.incidentStatus;
            state.lastChecked = Date.now();
            saveState();
          }
        }
      }
    }

    // Check for violations that are no longer present (they were resolved)
    for (const [incidentId, state] of Object.entries(violationState)) {
      if (!currentViolations.has(incidentId) && state.status === 'OPEN') {
        console.log(`Violation ${incidentId} no longer present, updating Jira ticket ${state.jiraKey} to Done`);
        await updateJiraTicketStatus(state.jiraKey, 'Done');
        state.status = 'CANCELLED';
        saveState();
      }
    }

    console.log(`[${new Date().toISOString()}] Check complete. Active violations: ${currentViolations.size}`);
  } catch (error) {
    console.error(`Error checking violations:`, error);
  }
}

// Main monitoring loop
async function startMonitoring(): Promise<void> {
  console.log("Starting AppDynamics Health Violations Monitor...");
  console.log(`Check interval: ${CHECK_INTERVAL_MS / 1000} seconds`);
  console.log(`Jira Project: ${JIRA_PROJECT_KEY}`);
  
  loadState();

  // Initial check
  await checkAndProcessViolations();

  // Set up interval
  setInterval(async () => {
    await checkAndProcessViolations();
  }, CHECK_INTERVAL_MS);

  console.log("Monitor running. Press Ctrl+C to stop.");
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log("\nShutting down monitor...");
  saveState();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log("\nShutting down monitor...");
  saveState();
  process.exit(0);
});

// Start the monitor
startMonitoring().catch(console.error);

