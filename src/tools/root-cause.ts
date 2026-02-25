/**
 * Tool: appd_diagnose_issue
 * Composite root cause analysis — fetches violations, anomalies, error events,
 * and snapshots in parallel, then correlates them into a structured diagnostic report.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appdGet } from "../services/api-client.js";
import { resolveAppId } from "../utils/app-resolver.js";
import { handleError, textResponse } from "../utils/error-handler.js";
import { truncateIfNeeded, formatTimestamp } from "../utils/formatting.js";
import type {
  HealthRuleViolation,
  AppDEvent,
  BusinessTransaction,
} from "../types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DIAG_ERROR_EVENT_TYPES = [
  "APPLICATION_ERROR",
  "APPLICATION_CRASH",
  "STALL",
  "SLOW_RESPONSE_TIME",
  "DEADLOCK",
  "GC_DURATION_VIOLATION",
  "MEMORY_VIOLATION",
  "CODE_PROBLEM",
].join(",");

const DIAG_ANOMALY_EVENT_TYPES = [
  "ANOMALY_OPEN_WARNING",
  "ANOMALY_OPEN_CRITICAL",
].join(",");

const DIAG_EVENT_SEVERITIES = "ERROR,WARN";

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAxios404(error: unknown): boolean {
  return (
    error instanceof Error &&
    "isAxiosError" in error &&
    "response" in error &&
    (error as Error & { response?: { status: number } }).response?.status ===
      404
  );
}

function normalizeViolations(data: unknown): HealthRuleViolation[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.healthRuleViolations)) return obj.healthRuleViolations;
    if (Array.isArray(obj.violations)) return obj.violations;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.problems)) {
      return (obj.problems as Array<Record<string, unknown>>).filter(
        (p) =>
          p.type === "HEALTH_RULE_VIOLATION" ||
          p.triggeredEntityType === "HEALTH_RULE" ||
          (typeof p.name === "string" && p.name.toLowerCase().includes("health"))
      ) as HealthRuleViolation[];
    }
  }
  return [];
}

/** Normalize the entity key used to group issues by affected entity. */
function entityKey(
  type: string | undefined,
  name: string | undefined
): string {
  return `${type ?? "UNKNOWN"}::${name ?? "UNKNOWN"}`;
}

interface EntityRecord {
  entity: string;
  entityType: string;
  issueCount: number;
  criticalCount: number;
  warningCount: number;
  otherCount: number;
  highestSeverity: string;
  evidence: string[];
}

interface TimelineEntry {
  time: string;
  type: string;
  severity: string;
  description: string;
}

// ── Input Schema ─────────────────────────────────────────────────────────────

const InputSchema = {
  application: z
    .union([z.string(), z.number()])
    .describe("Application name or numeric ID."),
  durationInMins: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Time window to analyse in minutes. Defaults to 60."),
  focus: z
    .enum(["all", "performance", "errors", "availability"])
    .optional()
    .describe(
      "Narrow the diagnosis focus. " +
        "'performance' = slow/stall events + snapshots + anomalies; " +
        "'errors' = error events + crash events + snapshots; " +
        "'availability' = health violations + anomalies; " +
        "'all' (default) = everything."
    ),
};

// ── Tool Registration ────────────────────────────────────────────────────────

export function registerRootCauseTools(server: McpServer): void {
  server.registerTool(
    "appd_diagnose_issue",
    {
      title: "Diagnose Issue (Root Cause Analysis)",
      description: `Perform an automated root cause analysis for an application.

Fetches health violations, anomalies, error events, transaction snapshots, and business transactions in parallel, then correlates them into a structured diagnostic report with ranked root cause candidates, a merged timeline, error breakdown, and suggested next investigation steps.

Use this when you need to quickly understand *why* an application is behaving badly without having to manually call 4-6 separate tools.

Args:
  - application (string|number): App name or numeric ID
  - durationInMins (number, optional): Lookback window in minutes (default: 60)
  - focus (string, optional): Narrow diagnosis to 'performance', 'errors', 'availability', or 'all' (default)

Returns: A structured diagnostic report with summary, ranked root cause candidates, timeline, error breakdown, affected entities, sample snapshots, and investigation steps.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ application, durationInMins, focus }) => {
      try {
        const appId = await resolveAppId(application);
        const duration = durationInMins ?? 60;
        const focusMode = focus ?? "all";

        const timeParams = {
          "time-range-type": "BEFORE_NOW",
          "duration-in-mins": duration,
        };

        // ── Parallel Fetches ───────────────────────────────────────────────

        const wantViolations =
          focusMode === "all" || focusMode === "availability";
        const wantErrorEvents =
          focusMode === "all" ||
          focusMode === "errors" ||
          focusMode === "performance";
        const wantAnomalies =
          focusMode === "all" ||
          focusMode === "availability" ||
          focusMode === "performance";
        const wantSnapshots =
          focusMode === "all" ||
          focusMode === "errors" ||
          focusMode === "performance";
        const wantBTs = focusMode === "all" || focusMode === "performance";

        const [
          violationsResult,
          errorEventsResult,
          anomalyEventsResult,
          snapshotsResult,
          btsResult,
        ] = await Promise.allSettled([
          // 1. Health rule violations (with fallback endpoint)
          wantViolations
            ? (async (): Promise<HealthRuleViolation[]> => {
                let data: unknown;
                try {
                  data = await appdGet(
                    `/controller/rest/applications/${appId}/problems/healthrule-violations`,
                    timeParams
                  );
                } catch (err) {
                  if (isAxios404(err)) {
                    data = await appdGet(
                      `/controller/rest/applications/${appId}/problems`,
                      timeParams
                    );
                  } else {
                    throw err;
                  }
                }
                return normalizeViolations(data);
              })()
            : Promise.resolve([] as HealthRuleViolation[]),

          // 2. Infrastructure & error events
          wantErrorEvents
            ? appdGet<AppDEvent[]>(
                `/controller/rest/applications/${appId}/events`,
                {
                  ...timeParams,
                  "event-types": DIAG_ERROR_EVENT_TYPES,
                  severities: DIAG_EVENT_SEVERITIES,
                }
              )
            : Promise.resolve([] as AppDEvent[]),

          // 3. ML anomaly events
          wantAnomalies
            ? appdGet<AppDEvent[]>(
                `/controller/rest/applications/${appId}/events`,
                {
                  ...timeParams,
                  "event-types": DIAG_ANOMALY_EVENT_TYPES,
                  severities: "INFO,WARN,ERROR",
                }
              )
            : Promise.resolve([] as AppDEvent[]),

          // 4. Sample snapshots (slow/error transactions)
          wantSnapshots
            ? appdGet(
                `/controller/rest/applications/${appId}/request-snapshots`,
                { ...timeParams, "maximum-results": 10 }
              )
            : Promise.resolve([]),

          // 5. Business transactions (for entity name correlation)
          wantBTs
            ? appdGet<BusinessTransaction[]>(
                `/controller/rest/applications/${appId}/business-transactions`
              )
            : Promise.resolve([] as BusinessTransaction[]),
        ]);

        // ── Unwrap results ─────────────────────────────────────────────────

        const violations: HealthRuleViolation[] =
          violationsResult.status === "fulfilled"
            ? violationsResult.value
            : [];

        const errorEvents: AppDEvent[] =
          errorEventsResult.status === "fulfilled"
            ? Array.isArray(errorEventsResult.value)
              ? errorEventsResult.value
              : []
            : [];

        const anomalyEvents: AppDEvent[] =
          anomalyEventsResult.status === "fulfilled"
            ? Array.isArray(anomalyEventsResult.value)
              ? anomalyEventsResult.value
              : []
            : [];

        const snapshots: unknown[] =
          snapshotsResult.status === "fulfilled"
            ? Array.isArray(snapshotsResult.value)
              ? snapshotsResult.value
              : []
            : [];

        const bts: BusinessTransaction[] =
          btsResult.status === "fulfilled" ? btsResult.value : [];

        // ── Correlation ────────────────────────────────────────────────────

        // Map entityKey → record of aggregated issues
        const entityMap = new Map<string, EntityRecord>();

        function ensureEntity(
          type: string | undefined,
          name: string | undefined
        ): EntityRecord {
          const k = entityKey(type, name);
          if (!entityMap.has(k)) {
            entityMap.set(k, {
              entity: name ?? "Unknown",
              entityType: type ?? "UNKNOWN",
              issueCount: 0,
              criticalCount: 0,
              warningCount: 0,
              otherCount: 0,
              highestSeverity: "INFO",
              evidence: [],
            });
          }
          return entityMap.get(k)!;
        }

        function bumpSeverity(rec: EntityRecord, severity: string): void {
          const order = ["INFO", "WARNING", "WARN", "ERROR", "CRITICAL"];
          const current = order.indexOf(rec.highestSeverity);
          const incoming = order.indexOf(severity.toUpperCase());
          if (incoming > current) {
            rec.highestSeverity = severity.toUpperCase();
          }
        }

        // Process violations
        for (const v of violations) {
          const rec = ensureEntity(v.affectedEntityType, v.affectedEntityName);
          rec.issueCount++;
          const sev = (v.severity ?? "").toUpperCase();
          if (sev === "CRITICAL") rec.criticalCount++;
          else if (sev === "WARNING" || sev === "WARN") rec.warningCount++;
          else rec.otherCount++;
          bumpSeverity(rec, sev);
          rec.evidence.push(`Health rule '${v.name}' ${sev}`);
        }

        // Process error events
        const errorGroupMap = new Map<string, number>(); // error class → count
        for (const ev of errorEvents) {
          const rec = ensureEntity(
            ev.affectedEntityType,
            ev.affectedEntityName
          );
          rec.issueCount++;
          rec.otherCount++;
          bumpSeverity(rec, ev.severity ?? "WARN");
          rec.evidence.push(`${ev.type} event`);

          // Extract error class from summary for error breakdown
          const summary = (ev.summary ?? "").trim();
          if (summary) {
            // Try to pull out a class name: first word before space/colon/semicolon
            const match = summary.match(/^([A-Za-z][\w.$]*(?:Exception|Error|Fault|Problem|Violation|Crash)?)/);
            const key = match ? match[1]! : summary.slice(0, 60);
            errorGroupMap.set(key, (errorGroupMap.get(key) ?? 0) + 1);
          }
        }

        // Process anomaly events
        for (const ev of anomalyEvents) {
          const rec = ensureEntity(
            ev.affectedEntityType,
            ev.affectedEntityName
          );
          rec.issueCount++;
          const sev = ev.type?.includes("CRITICAL") ? "CRITICAL" : "WARNING";
          if (sev === "CRITICAL") rec.criticalCount++;
          else rec.warningCount++;
          bumpSeverity(rec, sev);
          rec.evidence.push(`Anomaly detected (${ev.type})`);
        }

        // Deduplicate evidence per entity (keep first 5 unique)
        for (const rec of entityMap.values()) {
          rec.evidence = [...new Set(rec.evidence)].slice(0, 5);
        }

        // ── Rank root cause candidates ─────────────────────────────────────
        // Score = critical×3 + warning×2 + other×1
        const ranked = [...entityMap.values()]
          .map((rec) => ({
            ...rec,
            score: rec.criticalCount * 3 + rec.warningCount * 2 + rec.otherCount,
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(({ score: _score, criticalCount: _c, warningCount: _w, otherCount: _o, ...rest }) => rest);

        // ── Build merged timeline ──────────────────────────────────────────
        const timeline: TimelineEntry[] = [];

        for (const v of violations) {
          const ts = v.startTimeInMillis ?? v.detectedTimeInMillis;
          if (ts) {
            timeline.push({
              time: formatTimestamp(ts),
              type: "HEALTH_RULE_OPEN_" + (v.severity ?? "UNKNOWN").toUpperCase(),
              severity: (v.severity ?? "UNKNOWN").toUpperCase(),
              description: `Health rule '${v.name}' violated on ${v.affectedEntityName ?? "unknown entity"}`,
            });
          }
        }

        for (const ev of errorEvents) {
          if (ev.eventTime) {
            timeline.push({
              time: formatTimestamp(ev.eventTime),
              type: ev.type,
              severity: (ev.severity ?? "WARN").toUpperCase(),
              description: ev.summary ?? ev.type,
            });
          }
        }

        for (const ev of anomalyEvents) {
          if (ev.eventTime) {
            timeline.push({
              time: formatTimestamp(ev.eventTime),
              type: ev.type,
              severity: ev.type?.includes("CRITICAL") ? "CRITICAL" : "WARNING",
              description: ev.summary ?? ev.type,
            });
          }
        }

        // Sort descending (most recent first)
        timeline.sort((a, b) => {
          // ISO strings sort lexicographically when in same format
          return b.time > a.time ? 1 : b.time < a.time ? -1 : 0;
        });

        // Limit to 30 timeline entries
        const trimmedTimeline = timeline.slice(0, 30);

        // ── Affected entities ──────────────────────────────────────────────
        const affectedTiers = new Set<string>();
        const affectedBTs = new Set<string>();
        const affectedNodes = new Set<string>();

        for (const rec of entityMap.values()) {
          const t = rec.entityType.toUpperCase();
          if (
            t === "APPLICATION_COMPONENT" ||
            t === "TIER" ||
            t === "APPLICATION_COMPONENT_NODE"
          ) {
            if (t === "APPLICATION_COMPONENT_NODE") {
              affectedNodes.add(rec.entity);
            } else {
              affectedTiers.add(rec.entity);
            }
          } else if (t === "BUSINESS_TRANSACTION" || t === "APPLICATION_COMPONENT_BT") {
            affectedBTs.add(rec.entity);
          }
        }

        // Also pull tier names from snapshots' businessTransactionId → BT list
        for (const bt of bts) {
          if (affectedBTs.has(bt.name)) {
            affectedTiers.add(bt.tierName);
          }
        }

        // ── Issue start estimate ───────────────────────────────────────────
        const startTimes: number[] = violations
          .map((v) => v.startTimeInMillis ?? v.detectedTimeInMillis ?? 0)
          .filter((t) => t > 0);

        const issueStartedAround =
          startTimes.length > 0
            ? formatTimestamp(Math.min(...startTimes))
            : null;

        // ── Error breakdown ────────────────────────────────────────────────
        const errorBreakdown: Record<string, number> = {};
        for (const [k, v] of errorGroupMap.entries()) {
          errorBreakdown[k] = v;
        }

        // Sort descending by count
        const sortedErrorBreakdown = Object.fromEntries(
          Object.entries(errorBreakdown).sort(([, a], [, b]) => b - a)
        );

        // ── Summary string ─────────────────────────────────────────────────
        const totalViolations = violations.length;
        const criticalViolations = violations.filter(
          (v) => (v.severity ?? "").toUpperCase() === "CRITICAL"
        ).length;
        const totalAnomalies = anomalyEvents.length;
        const totalErrors = errorEvents.length;

        let summary: string;
        if (
          totalViolations === 0 &&
          totalAnomalies === 0 &&
          totalErrors === 0
        ) {
          summary = `No health violations, anomalies, or error events found in the last ${duration} minutes. The application appears healthy.`;
        } else {
          const parts: string[] = [];
          if (totalViolations > 0)
            parts.push(
              `${totalViolations} health violation${totalViolations !== 1 ? "s" : ""}` +
                (criticalViolations > 0 ? ` (${criticalViolations} CRITICAL)` : "")
            );
          if (totalAnomalies > 0)
            parts.push(
              `${totalAnomalies} anomal${totalAnomalies !== 1 ? "ies" : "y"}`
            );
          if (totalErrors > 0)
            parts.push(
              `${totalErrors} error/infrastructure event${totalErrors !== 1 ? "s" : ""}`
            );
          summary = `Found ${parts.join(", ")} in the last ${duration} minutes.`;
        }

        // ── Investigation steps ────────────────────────────────────────────
        const steps: string[] = [];
        let stepNum = 1;

        if (ranked.length > 0) {
          const top = ranked[0]!;
          steps.push(
            `${stepNum++}. Focus on '${top.entity}' (${top.entityType}) — highest severity signal with ${top.issueCount} issue${top.issueCount !== 1 ? "s" : ""}.`
          );
        }

        if (snapshots.length > 0) {
          const btSet = affectedBTs.size > 0 ? ` for ${[...affectedBTs].slice(0, 2).join(", ")} BT${affectedBTs.size > 1 ? "s" : ""}` : "";
          steps.push(
            `${stepNum++}. Review the ${snapshots.length} diagnostic snapshot${snapshots.length !== 1 ? "s" : ""}${btSet} to see call stacks, SQL, and HTTP calls at the time of the issue.`
          );
        }

        if (Object.keys(sortedErrorBreakdown).length > 0) {
          const topError = Object.keys(sortedErrorBreakdown)[0]!;
          steps.push(
            `${stepNum++}. Investigate '${topError}' — the most frequent error class (${sortedErrorBreakdown[topError]} occurrences). Check application logs for stack traces.`
          );
        }

        if (affectedTiers.size > 0) {
          steps.push(
            `${stepNum++}. Run appd_get_metric_data for 'Errors per Minute' and 'Average Response Time (ms)' on tier${affectedTiers.size > 1 ? "s" : ""} ${[...affectedTiers].slice(0, 3).join(", ")} to track metric trends.`
          );
        }

        if (totalViolations > 0 && issueStartedAround) {
          steps.push(
            `${stepNum++}. The earliest violation was detected around ${issueStartedAround} — check for deployments, config changes, or traffic spikes at that time.`
          );
        }

        if (steps.length === 0) {
          steps.push(
            "1. No issues detected. Use appd_get_metric_data or appd_browse_metric_tree to explore performance trends."
          );
        }

        // ── Assemble report ────────────────────────────────────────────────
        const report = {
          summary,
          timeWindow: `Last ${duration} minutes`,
          ...(issueStartedAround ? { issueStartedAround } : {}),
          topRootCauseCandidates: ranked,
          healthViolations: violations,
          anomalies: anomalyEvents,
          errorBreakdown: sortedErrorBreakdown,
          affectedEntities: {
            tiers: [...affectedTiers],
            businessTransactions: [...affectedBTs],
            nodes: [...affectedNodes],
          },
          timeline: trimmedTimeline,
          diagnosticSnapshots: snapshots,
          investigationSteps: steps,
        };

        return textResponse(truncateIfNeeded(report));
      } catch (error) {
        return handleError(error);
      }
    }
  );
}
