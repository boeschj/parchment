import type { ReactNode } from "react";

type MissingComponentProps = {
  componentName: string;
  reason?: string;
  children?: ReactNode;
};

export function MissingComponent({ componentName, reason, children }: MissingComponentProps) {
  return (
    <div className="bg-card text-card-foreground rounded-xl p-4 border-2 border-dashed border-amber-500/40">
      <div className="text-amber-600 text-sm font-medium">
        ⚠ Missing component: <code className="font-mono">{componentName}</code>
      </div>
      {reason ? <p className="text-muted-foreground text-xs mt-1">{reason}</p> : null}
      {children}
    </div>
  );
}
