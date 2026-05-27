import type { ReactNode } from "react";

type MissingComponentProps = {
  componentName: string;
  reason?: string;
  children?: ReactNode;
};

export function MissingComponent({ componentName, reason, children }: MissingComponentProps) {
  return (
    <div className="canvas-card p-4 border-2 border-dashed border-canvas-warning/40">
      <div className="text-canvas-warning text-sm font-medium">
        ⚠ Missing component: <code className="canvas-mono">{componentName}</code>
      </div>
      {reason ? <p className="text-canvas-muted text-xs mt-1">{reason}</p> : null}
      {children}
    </div>
  );
}
