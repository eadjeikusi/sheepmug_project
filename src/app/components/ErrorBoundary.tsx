import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = { hasError: boolean; message: string };

/**
 * Catches render errors so a failed tree does not leave a blank page (common in dev when something throws).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.setState({ message: error.message || String(error) });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 p-8 font-sans text-gray-900">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-600">
            The app hit a runtime error. Details below; also check the browser developer console (F12).
          </p>
          <pre className="mt-4 max-w-3xl overflow-auto rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 whitespace-pre-wrap">
            {this.state.message || "Unknown error"}
          </pre>
          <button
            type="button"
            className="mt-6 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
