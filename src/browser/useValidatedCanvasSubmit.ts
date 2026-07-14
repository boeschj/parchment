import { useEffect } from "react";
import { useActions, useValidation } from "@json-render/react";
import type { Slot } from "../shared/types.ts";
import { CANVAS_SUBMIT_ACTION, createFormSubmitHandler } from "./canvas-actions.ts";

// Registers canvas.submit from INSIDE JSONUIProvider.
//
// The handler map passed as JSONUIProvider's `handlers` prop is built above the
// provider (App.tsx), and json-render mounts its ValidationProvider inside it —
// so a handler in that map can never reach validateAll(), and a submit handler
// that cannot reach validateAll() cannot refuse an invalid form. Registering the
// handler here, one level below the provider, is what closes that gap: this is
// the only level of the tree that sees both the action registry and the form's
// registered checks.
//
// registerHandler overwrites by name, so this is the single definition of
// canvas.submit — there is no unvalidated version of it left to fall back to.
export function useValidatedCanvasSubmit(sessionId: string, slot: Slot): void {
  const { registerHandler } = useActions();
  const { validateAll } = useValidation();

  useEffect(() => {
    registerHandler(CANVAS_SUBMIT_ACTION, createFormSubmitHandler(sessionId, slot, validateAll));
  }, [registerHandler, validateAll, sessionId, slot]);
}
