import { projectStatusDashboardTemplate } from "./project-status-dashboard.ts";
import { prReviewTemplate } from "./pr-review.ts";
import { incidentTimelineTemplate } from "./incident-timeline.ts";
import { costReportTemplate } from "./cost-report.ts";
import { agentFleetSnapshotTemplate } from "./agent-fleet-snapshot.ts";
import type { StarterTemplate } from "./types.ts";

// Seeded into a fresh install's ~/.parchment/library/ (see
// src/daemon/library.ts ensureLibrarySeeded) so canvas_library and the
// browser's library panel have real, well-composed examples from the first
// session onward.
export const STARTER_TEMPLATES: StarterTemplate[] = [
  projectStatusDashboardTemplate,
  prReviewTemplate,
  incidentTimelineTemplate,
  costReportTemplate,
  agentFleetSnapshotTemplate,
];

export type { StarterTemplate } from "./types.ts";
