import { SlotKind } from "../types.ts";
import { MetricTone, MetricTrend } from "../catalog/extensions/Metric.ts";
import { StepStatus } from "../catalog/extensions/Steps.ts";
import { CalloutTone } from "../catalog/extensions/Callout.ts";
import type { StarterTemplate } from "./types.ts";

// "Project status dashboard" — the weekly stand-up-in-a-glance: headline
// KPIs, a milestone timeline with the blocker called out, per-workstream
// health, and the backlog underneath the fold.
export const projectStatusDashboardTemplate: StarterTemplate = {
  name: "project-status-dashboard",
  title: "Project status dashboard",
  kind: SlotKind.Dashboard,
  spec: {
    root: "page",
    elements: {
      page: {
        type: "Stack",
        props: { gap: "lg" },
        children: ["title", "tldr", "kpis", "milestones-card", "workstreams", "backlog", "risk"],
      },
      title: {
        type: "Heading",
        props: { text: "Core API platform — sprint 14 status", level: "h1" },
        children: [],
      },
      tldr: {
        type: "Callout",
        props: {
          tone: CalloutTone.Info,
          title: "TL;DR",
          body: "On track for the Sep 30 release cut. Auth migration is the main risk — one blocked task, mitigation in progress.",
        },
        children: [],
      },
      kpis: {
        type: "Grid",
        props: { columns: 4, gap: "md" },
        children: ["m-velocity", "m-open-prs", "m-bugs", "m-days"],
      },
      "m-velocity": {
        type: "Metric",
        props: {
          label: "Sprint velocity",
          value: "38 pts",
          delta: "+6 pts",
          trend: MetricTrend.Up,
          tone: MetricTone.Success,
          detail: "vs. 32 pts last sprint",
        },
        children: [],
      },
      "m-open-prs": {
        type: "Metric",
        props: {
          label: "Open PRs",
          value: "7",
          delta: "-3",
          trend: MetricTrend.Down,
          tone: MetricTone.Success,
          detail: "avg age 1.2 days",
        },
        children: [],
      },
      "m-bugs": {
        type: "Metric",
        props: {
          label: "Open bugs",
          value: "4",
          delta: "+1",
          trend: MetricTrend.Up,
          tone: MetricTone.Warning,
          detail: "1 P1, 3 P2",
        },
        children: [],
      },
      "m-days": {
        type: "Metric",
        props: { label: "Days to release", value: "11", detail: "Sep 30 cut" },
        children: [],
      },
      "milestones-card": {
        type: "Card",
        props: { title: "Release milestones" },
        children: ["milestones-steps"],
      },
      "milestones-steps": {
        type: "Steps",
        props: {
          items: [
            {
              title: "Auth migration to OAuth2",
              detail: "Blocked on the tenant migration script — see the watch item below",
              status: StepStatus.Error,
            },
            { title: "Rate limiting rollout", detail: "Staged to 50% of traffic", status: StepStatus.Active },
            { title: "API v2 deprecation notice", status: StepStatus.Done },
            { title: "Load test at 2x peak traffic", status: StepStatus.Pending },
          ],
        },
        children: [],
      },
      workstreams: {
        type: "Grid",
        props: { columns: 3, gap: "md" },
        children: ["ws-platform", "ws-auth", "ws-billing"],
      },
      "ws-platform": {
        type: "Card",
        props: { title: "Platform", description: "Owner: @dana" },
        children: ["ws-platform-badge", "ws-platform-text"],
      },
      "ws-platform-badge": {
        type: "Badge",
        props: { text: "On track", variant: "default" },
        children: [],
      },
      "ws-platform-text": {
        type: "Text",
        props: { text: "Infra migration to the new k8s cluster is 80% complete.", variant: "muted" },
        children: [],
      },
      "ws-auth": {
        type: "Card",
        props: { title: "Auth & identity", description: "Owner: @priya" },
        children: ["ws-auth-badge", "ws-auth-text"],
      },
      "ws-auth-badge": {
        type: "Badge",
        props: { text: "Blocked", variant: "destructive" },
        children: [],
      },
      "ws-auth-text": {
        type: "Text",
        props: {
          text: "OAuth2 tenant migration script fails on legacy accounts with a null email.",
          variant: "muted",
        },
        children: [],
      },
      "ws-billing": {
        type: "Card",
        props: { title: "Billing", description: "Owner: @marcus" },
        children: ["ws-billing-badge", "ws-billing-text"],
      },
      "ws-billing-badge": {
        type: "Badge",
        props: { text: "On track", variant: "default" },
        children: [],
      },
      "ws-billing-text": {
        type: "Text",
        props: { text: "Usage-based pricing model is in QA, ships with v2.", variant: "muted" },
        children: [],
      },
      backlog: {
        type: "DataTable",
        props: {
          caption: "Sprint 14 backlog",
          exportable: true,
          columns: [
            { key: "task", header: "Task" },
            { key: "owner", header: "Owner" },
            { key: "priority", header: "Priority" },
            { key: "status", header: "Status" },
          ],
          rows: [
            { task: "Fix tenant migration null-email crash", owner: "priya", priority: "P1", status: "in progress" },
            { task: "Roll rate limiting to 100% of traffic", owner: "dana", priority: "P2", status: "in progress" },
            { task: "Usage-based pricing QA sign-off", owner: "marcus", priority: "P2", status: "review" },
            { task: "Write v2 deprecation migration guide", owner: "dana", priority: "P3", status: "todo" },
            { task: "Load test checkout path at 2x peak", owner: "priya", priority: "P2", status: "todo" },
          ],
        },
        children: [],
      },
      risk: {
        type: "Callout",
        props: {
          tone: CalloutTone.Warning,
          title: "Watch item",
          body: "If the tenant migration script isn't fixed by Wednesday, the auth rollout slips a week. Fallback: carry legacy auth as an exception path for null-email accounts.",
        },
        children: [],
      },
    },
  },
};
