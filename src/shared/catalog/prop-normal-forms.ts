// The declared input forms for component props — the ONE contract between what
// the model is told a prop accepts and what the daemon accepts. Each entry
// widens a prop's schema with a total, semantics-preserving normalization to
// the normal form the renderer consumes (gap 16 → "md" loses nothing).
// Tolerances that could mask intent errors (unseeded state paths, non-numeric
// chart series data) are deliberately NOT here; spec-validation.ts keeps those
// strict, with fix-hints. The accepted forms are documented for the model in
// skills/canvas-spec/SKILL.md.

import * as z from "zod/v4";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { CanvasExtensionDefinitions } from "./index.ts";
import { ChartXScale } from "./extensions/Chart.ts";
import { isPlainObject } from "../expressions.ts";

export type PropNormalizer = (value: unknown) => unknown;

// Prop names accepted as aliases for the normal-form name, per component.
// Alias keys are lowercase; incoming names match case-insensitively, and an
// alias never overwrites a prop the spec already set under the normal name.
export const PropNameAliases: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  Chart: { xkey: "x", ykey: "y", ykeys: "y" },
  DataTable: { data: "rows" },
};

// The spacing scale numeric gaps are read against (as pixels). Nearest token
// wins; the scale ascends, and normalizers resolve ties toward the larger
// (more visible) token.
const SPACING_SCALE = [
  { token: "none", pixels: 0 },
  { token: "sm", pixels: 8 },
  { token: "md", pixels: 16 },
  { token: "lg", pixels: 24 },
  { token: "xl", pixels: 32 },
] as const;

type SpacingToken = (typeof SPACING_SCALE)[number]["token"];

const STACK_GAP_TOKENS: ReadonlySet<SpacingToken> = new Set(["none", "sm", "md", "lg", "xl"]);
const GRID_GAP_TOKENS: ReadonlySet<SpacingToken> = new Set(["sm", "md", "lg", "xl"]);

const SPACING_WORD_TO_TOKEN = {
  none: "none",
  zero: "none",
  xxs: "sm",
  "2xs": "sm",
  xs: "sm",
  tiny: "sm",
  small: "sm",
  medium: "md",
  normal: "md",
  large: "lg",
  big: "lg",
  xlarge: "xl",
  xxl: "xl",
  "2xl": "xl",
  huge: "xl",
} as const satisfies Record<string, SpacingToken>;

const STACK_DIRECTION_TO_TOKEN = {
  row: "horizontal",
  horizontal: "horizontal",
  column: "vertical",
  col: "vertical",
  vertical: "vertical",
} as const;

const BUTTON_VARIANT_TO_TOKEN = {
  default: "primary",
  destructive: "danger",
  error: "danger",
  outline: "secondary",
  ghost: "secondary",
  link: "secondary",
} as const;

const BADGE_VARIANT_TO_TOKEN = {
  danger: "destructive",
  error: "destructive",
  primary: "default",
} as const;

const TEXT_VARIANT_TO_TOKEN = {
  default: "body",
  normal: "body",
  secondary: "muted",
  subtle: "muted",
  small: "caption",
  subtitle: "lead",
} as const;

const CHART_XSCALE_TO_TOKEN = {
  linear: ChartXScale.Category,
  numeric: ChartXScale.Category,
  ordinal: ChartXScale.Category,
  timestamp: ChartXScale.Time,
  datetime: ChartXScale.Time,
  date: ChartXScale.Time,
} as const;

const HEADING_LEVEL_MIN = 1;
const HEADING_LEVEL_MAX = 4;

// One normalizer per widened (component, prop). Every normalizer is total and
// identity-preserving: values already in normal form (and values it cannot
// resolve) pass through unchanged, so the base schema still rejects genuinely
// ambiguous input with its exact fix.
export const PropNormalForms: Readonly<Record<string, Readonly<Record<string, PropNormalizer>>>> = {
  Stack: {
    gap: spacingTokenNormalizer(STACK_GAP_TOKENS),
    direction: synonymNormalizer(STACK_DIRECTION_TO_TOKEN),
  },
  Grid: {
    gap: spacingTokenNormalizer(GRID_GAP_TOKENS),
  },
  Heading: {
    level: normalizeHeadingLevel,
  },
  Button: {
    variant: synonymNormalizer(BUTTON_VARIANT_TO_TOKEN),
  },
  Badge: {
    variant: synonymNormalizer(BADGE_VARIANT_TO_TOKEN),
  },
  Text: {
    variant: synonymNormalizer(TEXT_VARIANT_TO_TOKEN),
  },
  Chart: {
    xScale: synonymNormalizer(CHART_XSCALE_TO_TOKEN),
  },
  Metric: {
    value: normalizeNumberToDisplayString,
    delta: normalizeNumberToDisplayString,
  },
  DataTable: {
    columns: normalizeColumnLabelToHeader,
  },
};

// Every component's props schema with the declared input forms folded in as
// z.preprocess steps, so the widened forms parse directly through the schema.
// shadcn definitions come from @json-render/shadcn and are widened here rather
// than forked.
export const WidenedComponentPropSchemas: Readonly<Record<string, z.ZodObject>> =
  Object.fromEntries(
    Object.entries({ ...shadcnComponentDefinitions, ...CanvasExtensionDefinitions }).map(
      ([componentName, definition]) => {
        return [componentName, widenPropsSchema(componentName, definition.props)] as const;
      },
    ),
  );

function widenPropsSchema(componentName: string, baseProps: z.ZodObject): z.ZodObject {
  const normalizers = PropNormalForms[componentName];
  if (!normalizers) return baseProps;
  const widenedShape = Object.fromEntries(
    Object.entries(normalizers).map(([propName, normalize]) => {
      const baseField = baseProps.shape[propName];
      if (!baseField) {
        throw new Error(
          `prop-normal-forms: "${componentName}.${propName}" is not in the component's props schema`,
        );
      }
      return [propName, z.preprocess(normalize, baseField)] as const;
    }),
  );
  return baseProps.extend(widenedShape);
}

function spacingTokenNormalizer(allowedTokens: ReadonlySet<SpacingToken>): PropNormalizer {
  return (value) => {
    const pixels = parsePixels(value);
    if (pixels !== null) return nearestSpacingToken(pixels, allowedTokens);
    const token = synonymOf(SPACING_WORD_TO_TOKEN, value);
    if (token !== null && allowedTokens.has(token)) return token;
    return value;
  };
}

const NUMERIC_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

function parsePixels(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && NUMERIC_STRING_PATTERN.test(value.trim())) {
    return Number.parseFloat(value.trim());
  }
  return null;
}

function nearestSpacingToken(
  pixels: number,
  allowedTokens: ReadonlySet<SpacingToken>,
): SpacingToken {
  let nearest: SpacingToken = "md";
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const { token, pixels: tokenPixels } of SPACING_SCALE) {
    if (!allowedTokens.has(token)) continue;
    const distance = Math.abs(tokenPixels - pixels);
    const isCloser = distance < nearestDistance;
    const isTieTowardLargerToken = distance === nearestDistance;
    if (isCloser || isTieTowardLargerToken) {
      nearest = token;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function normalizeHeadingLevel(value: unknown): unknown {
  const level = leadingIntegerOf(value);
  if (level === null) return value;
  const clamped = Math.min(Math.max(level, HEADING_LEVEL_MIN), HEADING_LEVEL_MAX);
  return `h${clamped}`;
}

function leadingIntegerOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/\d+/);
  if (!match) return null;
  return Number.parseInt(match[0], 10);
}

function normalizeNumberToDisplayString(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return value;
}

function normalizeColumnLabelToHeader(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const columns = value.map((column) => {
    if (!isPlainObject(column)) return column;
    if (column.header !== undefined || typeof column.label !== "string") return column;
    changed = true;
    const { label, ...rest } = column;
    return { ...rest, header: label };
  });
  return changed ? columns : value;
}

function synonymNormalizer(synonymToToken: Readonly<Record<string, string>>): PropNormalizer {
  return (value) => synonymOf(synonymToToken, value) ?? value;
}

function synonymOf<Token extends string>(
  synonymToToken: Readonly<Record<string, Token>>,
  value: unknown,
): Token | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(synonymToToken, normalized)) return null;
  return synonymToToken[normalized] ?? null;
}
