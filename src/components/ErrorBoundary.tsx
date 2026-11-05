import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackLabel: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// There is otherwise no error-boundary coverage anywhere in this app - an uncaught throw during
// any tab's render would blank the entire app, not just that tab. One of these wraps each tab's
// content in App.tsx so a bug in one tab shows an inline message there while the tab bar and
// every other tab keep working. Must be a class component - function components can't implement
// getDerivedStateFromError/componentDidCatch.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`[error-boundary] ${this.props.fallbackLabel} crashed`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <p className="text-sm text-red-600 dark:text-red-400">
          Something went wrong in {this.props.fallbackLabel}. Try switching tabs and back.
        </p>
      );
    }
    return this.props.children;
  }
}
