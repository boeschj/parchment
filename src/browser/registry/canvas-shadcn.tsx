// Owned shadcn-primitive implementations matching Style Guide.html.
//
// Same prop contracts as @json-render/shadcn (so Claude's specs still
// validate against shadcnComponentDefinitions in the catalog), but rendered
// with our design language:
//   - 24px radius default (--radius), flat borderless surfaces (the focus
//     ring is the only outline anywhere)
//   - Pill buttons + badges (--radius-full)
//   - Geist + Geist Mono typography
//   - Gold #CEA500 primary, alpha borders, hairline separators
//
// Wired into the registry via spread-after-shadcnComponents in registry.ts,
// so these win for any of the listed component names.

import type { ReactNode } from "react";
import type { BaseComponentProps } from "@json-render/react";
import type { ShadcnProps } from "@json-render/shadcn";

// ---- shared helpers -------------------------------------------------------

const GAP_CLASS: Record<string, string> = {
  none: "gap-0",
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-4",
  xl: "gap-6",
};

const ALIGN_CLASS: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

const JUSTIFY_CLASS: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
};

const MAX_WIDTH_CLASS: Record<string, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  full: "w-full",
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---- Card -----------------------------------------------------------------
// Flat borderless surface, 24px radius, 24px padding.
// Optional title + description rendered as a header block above children.

export function Card({ props, children }: BaseComponentProps<ShadcnProps<"Card">>) {
  const widthClass = props.maxWidth ? MAX_WIDTH_CLASS[props.maxWidth] ?? "w-full" : "w-full";
  const centeredClass = props.centered ? "mx-auto" : "";
  const hasHeader = Boolean(props.title) || Boolean(props.description);

  return (
    <div
      className={cx("bg-card text-card-foreground p-6", widthClass, centeredClass, props.className ?? undefined)}
      style={{ borderRadius: "var(--radius)" }}
    >
      {hasHeader ? (
        <header className={cx("flex flex-col gap-1", children ? "mb-4" : "")}>
          {props.title ? (
            <h3 className="text-base font-semibold tracking-tight leading-snug">
              {props.title}
            </h3>
          ) : null}
          {props.description ? (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {props.description}
            </p>
          ) : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}

// ---- Stack ---------------------------------------------------------------

export function Stack({ props, children }: BaseComponentProps<ShadcnProps<"Stack">>) {
  const directionClass = props.direction === "horizontal" ? "flex-row" : "flex-col";
  const gapClass = GAP_CLASS[props.gap ?? "md"] ?? "gap-3";
  const alignClass = props.align ? ALIGN_CLASS[props.align] : "";
  const justifyClass = props.justify ? JUSTIFY_CLASS[props.justify] : "";

  return (
    <div
      className={cx(
        "flex",
        directionClass,
        gapClass,
        alignClass,
        justifyClass,
        props.className ?? undefined,
      )}
    >
      {children}
    </div>
  );
}

// ---- Grid ----------------------------------------------------------------

const GRID_COLS_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

export function Grid({ props, children }: BaseComponentProps<ShadcnProps<"Grid">>) {
  const cols = Number.isFinite(props.columns) ? Math.max(1, Math.min(6, props.columns!)) : 3;
  const colsClass = GRID_COLS_CLASS[cols] ?? "grid-cols-3";
  const gapClass = GAP_CLASS[props.gap ?? "md"] ?? "gap-3";

  return (
    <div className={cx("grid", colsClass, gapClass, props.className ?? undefined)}>
      {children}
    </div>
  );
}

// ---- Separator ------------------------------------------------------------
// Hairline by default — softer than --border. Used between content rows.

export function Separator({ props }: BaseComponentProps<ShadcnProps<"Separator">>) {
  const horizontal = props.orientation !== "vertical";
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      className={horizontal ? "w-full h-px" : "w-px h-full"}
      style={{ background: "var(--hairline)" }}
    />
  );
}

// ---- Heading -------------------------------------------------------------

const HEADING_CLASS: Record<string, string> = {
  h1: "text-[2.25rem] font-semibold leading-[1.1] tracking-[-0.022em]",
  h2: "text-2xl font-semibold leading-tight tracking-[-0.012em]",
  h3: "text-xl font-semibold leading-snug tracking-tight",
  h4: "text-base font-semibold leading-snug tracking-tight",
};

export function Heading({ props }: BaseComponentProps<ShadcnProps<"Heading">>) {
  const level = props.level ?? "h2";
  const className = HEADING_CLASS[level] ?? HEADING_CLASS["h2"]!;
  const text = props.text;

  switch (level) {
    case "h1":
      return <h1 className={className}>{text}</h1>;
    case "h2":
      return <h2 className={className}>{text}</h2>;
    case "h3":
      return <h3 className={className}>{text}</h3>;
    case "h4":
      return <h4 className={className}>{text}</h4>;
    default:
      return <h2 className={className}>{text}</h2>;
  }
}

// ---- Text ---------------------------------------------------------------

const TEXT_CLASS: Record<string, string> = {
  body: "text-base leading-relaxed text-foreground",
  caption: "text-xs leading-snug text-muted-foreground",
  muted: "text-sm leading-relaxed text-muted-foreground",
  lead: "text-lg leading-relaxed text-foreground",
  code: "text-sm font-mono leading-snug text-foreground",
};

export function Text({ props }: BaseComponentProps<ShadcnProps<"Text">>) {
  const variant = props.variant ?? "body";
  const className = TEXT_CLASS[variant] ?? TEXT_CLASS["body"]!;
  if (variant === "code") {
    return <code className={className}>{props.text}</code>;
  }
  return <p className={className}>{props.text}</p>;
}

// ---- Badge --------------------------------------------------------------
// Per Style Guide: pill (rounded-full), 11px Geist Mono, 4px 10px padding,
// 4 variants matching the shadcn schema.

const BADGE_VARIANT_CLASS: Record<string, string> = {
  default: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  destructive: "text-destructive",
  outline: "text-foreground",
};

const BADGE_BORDER_STYLE: Record<string, { bg?: string; border?: string }> = {
  default: {},
  secondary: {},
  destructive: { bg: "color-mix(in oklab, var(--destructive) 12%, transparent)" },
  outline: { border: "1px solid var(--border)" },
};

export function Badge({ props }: BaseComponentProps<ShadcnProps<"Badge">>) {
  const variant = props.variant ?? "default";
  const variantClass = BADGE_VARIANT_CLASS[variant] ?? BADGE_VARIANT_CLASS["default"]!;
  const variantStyle = BADGE_BORDER_STYLE[variant] ?? {};

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full font-mono px-2.5 py-1 text-[11px] leading-none",
        variantClass,
      )}
      style={{
        ...(variantStyle.bg ? { background: variantStyle.bg } : {}),
        ...(variantStyle.border ? { border: variantStyle.border } : {}),
      }}
    >
      {props.text}
    </span>
  );
}

// ---- Button -------------------------------------------------------------
// Per Style Guide: pill (rounded-full), 36px height, 16px horizontal padding,
// 13.5px / 500 weight. Variants matching shadcn schema: primary, secondary,
// danger. (No ghost variant in the catalog — for ghost-like behavior, use a
// secondary button on a card surface.)

const BUTTON_VARIANT_CLASS: Record<string, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
  danger: "bg-destructive text-white hover:opacity-90",
};

export function Button({
  props,
  emit,
}: BaseComponentProps<ShadcnProps<"Button">>) {
  const variant = props.variant ?? "primary";
  const variantClass = BUTTON_VARIANT_CLASS[variant] ?? BUTTON_VARIANT_CLASS["primary"]!;
  const disabled = props.disabled === true;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => emit("press")}
      className={cx(
        "inline-flex items-center justify-center gap-2 h-9 rounded-full px-4 text-[13.5px] font-medium transition-all",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px]",
        variantClass,
      )}
    >
      {props.label}
    </button>
  );
}

// ---- Alert --------------------------------------------------------------
// Per Style Guide: flat card surface with a tinted icon chip carrying the
// semantic color. type controls the tint.

type AlertType = "info" | "success" | "warning" | "error";

const ALERT_ICON: Record<AlertType, string> = {
  info: "ⓘ",
  success: "✓",
  warning: "⚠",
  error: "✗",
};

const ALERT_ACCENT_VAR: Record<AlertType, string> = {
  info: "var(--primary)",
  success: "var(--success)",
  warning: "#D97706",
  error: "var(--destructive)",
};

type AlertChildren = { children?: ReactNode };

export function Alert({
  props,
  children,
}: BaseComponentProps<ShadcnProps<"Alert">> & AlertChildren) {
  const type: AlertType = (props.type ?? "info") as AlertType;
  const accent = ALERT_ACCENT_VAR[type];

  return (
    <div
      className="flex gap-3 p-5 bg-card text-card-foreground"
      style={{ borderRadius: "var(--radius)" }}
      role="alert"
    >
      <span
        aria-hidden
        className="flex-none w-6 h-6 inline-flex items-center justify-center rounded-full text-sm font-medium"
        style={{
          background: `color-mix(in oklab, ${accent} 15%, transparent)`,
          color: accent,
        }}
      >
        {ALERT_ICON[type]}
      </span>
      <div className="flex flex-col gap-1 min-w-0">
        <div className="text-sm font-semibold leading-snug">{props.title}</div>
        {props.message ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {props.message}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

// ---- exported map for registry.ts ---------------------------------------

export const canvasShadcnOverrides = {
  Card,
  Stack,
  Grid,
  Separator,
  Heading,
  Text,
  Badge,
  Button,
  Alert,
};
