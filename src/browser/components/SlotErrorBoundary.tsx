import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  slotId: string;
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class SlotErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[canvas] slot error", this.props.slotId, error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="canvas-card p-4 border-canvas-error/40 border-2 border-dashed">
          <div className="text-canvas-error text-sm font-medium">
            ⚠ Slot rendering crashed
          </div>
          <p className="text-canvas-muted text-xs mt-1">
            slot id: <code className="canvas-mono">{this.props.slotId}</code>
          </p>
          <pre className="text-canvas-muted text-xs mt-2 overflow-auto max-h-40">
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
