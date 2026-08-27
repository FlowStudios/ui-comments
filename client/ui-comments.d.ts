export interface UICommentsInitOptions {
  endpoint?: string;
  project?: string;
  always?: boolean;
  /**
   * Shared secret for the endpoint. Prefer NOT setting this — it would land in
   * your client bundle. Arm with ?uicomment=1&uickey=SECRET instead and the
   * client keeps it in localStorage.
   */
  key?: string;
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
