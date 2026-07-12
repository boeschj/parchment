import { CanvasTool } from "../config.ts";
import type { ScenarioDefinition } from "./types.ts";

export const validatedFormScenario: ScenarioDefinition = {
  id: "validated-form",
  title: "Signup form with validation + submit",
  parchmentTool: CanvasTool.Render,
  parchmentPrompt: `Use canvas_render to build a signup form with: an Input for name (required), an
Input of type email for email (required), an Input of type password for password (required,
minimum 8 characters), and a Button labeled "Sign up" wired to canvas.submit. Seed form state
so the inputs are controlled.`,
  htmlPrompt: `Write a single self-contained HTML file at ./signup.html with a signup <form>
containing: a required text input for name, a required input of type="email" for email, a
required input of type="password" for password with minlength="8", and a submit button
labeled "Sign up". Use the browser's native HTML5 validation attributes (required, type,
minlength) — no external stylesheets, scripts, or CDN links.`,
  parchmentRequirement: {
    minimumCountByComponentType: { Input: 3, Button: 1 },
  },
  htmlRequirements: [
    { description: "declares an HTML document", pattern: /<html[\s>]/i, minimumMatches: 1 },
    { description: "has a form", pattern: /<form[\s>]/i, minimumMatches: 1 },
    { description: "has at least 3 inputs", pattern: /<input[\s>]/i, minimumMatches: 3 },
    { description: "has an email input", pattern: /type=["']email["']/i, minimumMatches: 1 },
    { description: "has a password input with a minimum length", pattern: /type=["']password["'][^>]*minlength/i, minimumMatches: 1 },
    { description: "has at least 3 required fields", pattern: /\brequired\b/i, minimumMatches: 3 },
    { description: "has a submit control labeled Sign up", pattern: /Sign up/i, minimumMatches: 1 },
  ],
};
