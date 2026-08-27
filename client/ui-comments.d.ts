export interface UICommentsInitOptions {
  endpoint?: string;
  project?: string;
  always?: boolean;
  context?: Record<string, unknown> | ((el: Element) => unknown) | null;
}

export interface UICommentsApi {
  init(opts?: UICommentsInitOptions): UICommentsApi;
  /** Enter/leave comment mode. Omit the argument to flip it. */
  toggle(on?: boolean): void;
  /** Arm for this browser (same as ?uicomment=1). */
  enable(): void;
  disable(): void;
  readonly armed: boolean;
}

declare global {
  interface Window {
    UIComments?: UICommentsApi;
  }
}

declare const api: UICommentsApi;
export default api;
