/*
 * Next.js App Router adapter.
 *
 *   // app/api/ui-comment/route.js
 *   import { createUiCommentRoute } from 'ui-comments/server/next-route';
 *   export const POST = createUiCommentRoute();
 *
 * Reads UI_COMMENTS_REPO / UI_COMMENTS_GH_TOKEN from the environment unless
 * you pass them explicitly. Never import this from a client component — the
 * token must stay server-side.
 */

'use strict';

const { createIssue } = require('./github');

function createUiCommentRoute(config = {}) {
  return async function POST(request) {
    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
    }

    const resolved = {
      repo: config.repo || process.env.UI_COMMENTS_REPO,
      token: config.token || process.env.UI_COMMENTS_GH_TOKEN,
      label: config.label,
      titlePrefix: config.titlePrefix,
      assignees: config.assignees,
    };

    const out = await createIssue(payload, resolved);
    return Response.json(out.body, { status: out.status });
  };
}

module.exports = { createUiCommentRoute, createIssue };
