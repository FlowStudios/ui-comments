import type { UICommentsConfig } from './github';

/** Returns a Next.js App Router POST handler that files the comment as a GitHub issue. */
export function createUiCommentRoute(
  config?: UICommentsConfig,
): (request: Request) => Promise<Response>;

export { createIssue } from './github';
export type { UICommentsConfig, UICommentPayload } from './github';
