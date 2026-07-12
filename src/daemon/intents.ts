import type {
  ActionBinding,
  IntentDefinition,
  IntentMenu,
  JsonRenderSpec,
  Slot,
  UIElement,
} from "../shared/types.ts";

export const INTENT_ACTION = "canvas.intent";

export type IntentMenuExtraction = {
  menu: IntentMenu;
  issues: string[];
};

// SECURITY: the intent menu is extracted from the spec ONCE, daemon-side, at
// slot push time. Params must be static JSON — expression values ({$state},
// {$template}, ...) are rejected because the daemon could not resolve them,
// and resolving them browser-side would let the page author the payload. The
// browser later submits only an opaque id; resolveIntent maps it back to the
// definition recorded here.
export function extractIntentMenu(spec: JsonRenderSpec): IntentMenuExtraction {
  const menu: IntentMenu = {};
  const issues: string[] = [];

  for (const [elementKey, element] of Object.entries(spec.elements)) {
    for (const binding of intentBindingsOf(element)) {
      const issue = validateIntentBinding(elementKey, binding, menu);
      if (issue) {
        issues.push(issue);
        continue;
      }
      const definition = toIntentDefinition(binding);
      menu[definition.id] = definition;
    }
  }

  return { menu, issues };
}

export function resolveIntent(slot: Slot, intentId: string): IntentDefinition | null {
  if (!slot.intentMenu) return null;
  return slot.intentMenu[intentId] ?? null;
}

function intentBindingsOf(element: UIElement): ActionBinding[] {
  if (!element.on) return [];
  const allBindings = Object.values(element.on).flat();
  return allBindings.filter((binding) => binding.action === INTENT_ACTION);
}

function validateIntentBinding(
  elementKey: string,
  binding: ActionBinding,
  menuSoFar: IntentMenu,
): string | null {
  const id = binding.params?.id;
  if (typeof id !== "string" || id.length === 0) {
    return `elements/${elementKey}: canvas.intent binding needs a non-empty string params.id`;
  }
  if (menuSoFar[id]) {
    return `elements/${elementKey}: duplicate intent id "${id}" — intent ids must be unique per slot`;
  }
  const staticParams = binding.params?.params;
  if (staticParams !== undefined && !isPlainObject(staticParams)) {
    return `elements/${elementKey}: intent "${id}" params.params must be an object`;
  }
  if (staticParams !== undefined && containsExpressionValue(staticParams)) {
    return `elements/${elementKey}: intent "${id}" params must be static JSON — no $state/$template expressions (the daemon records the payload at render time; use canvas.submit for form data)`;
  }
  return null;
}

function toIntentDefinition(binding: ActionBinding): IntentDefinition {
  const id = binding.params?.id as string;
  const staticParams = binding.params?.params;
  if (isPlainObject(staticParams)) {
    return { id, params: staticParams };
  }
  return { id };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsExpressionValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsExpressionValue);
  if (!isPlainObject(value)) return false;
  const hasExpressionKey = Object.keys(value).some((key) => key.startsWith("$"));
  if (hasExpressionKey) return true;
  return Object.values(value).some(containsExpressionValue);
}
