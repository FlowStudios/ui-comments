/*
 * Next.js App Router adapter.
 *
 *   // app/api/ui-comment/route.js
 *   import { createUiCommentRoute } from 'ui-comments/server/next-route';
 *   export const POST = createUiCommentRoute();
 *
 * Reads UI_COMMENTS_REPO / UI_COMMENTS_GH_TOKEN / UI_COMMENTS_KEY from the
 * environment unless you pass them explicitly. Never import this from a client
 * component — the token must stay server-side.
 */

'use strict';

const crypto = require('crypto');
const { createIssue } = require('./github');

/* Constant-time compare that does not leak the secret's length. */
function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* A per-process cap, so a leaked key cannot file a thousand issues before
   anyone notices. Not a distributed limiter — one pm2 fork is the unit. */
function makeLimiter(max, windowMs) {
  const hits = [];
  return function allow() {
    const now = Date.now();
    while (hits.length && now - hits[0] > windowMs) {
      hits.shift();
    }
    if (hits.length >= max) {
      return false;
    }
    hits.push(now);
    return true;
  };
}

function createUiCommentRoute(config = {}) {
  const limit = config.rateLimit === null
    ? null
    : makeLimiter(
      (config.rateLimit && config.rateLimit.max) || 20,
      (config.rateLimit && config.rateLimit.windowMs) || 10 * 60 * 1000,
    );

  return async function POST(request) {
    const secret = config.key !== undefined ? config.key : process.env.UI_COMMENTS_KEY;

    /* When a secret is configured the endpoint is closed by default — an
       unauthenticated Next app is otherwise an open door onto the repo's
       issue tracker. */
    if (secret) {
      const sent = request.headers.get('x-ui-comments-key') || '';
      if (!sent || !sameSecret(sent, secret)) {
        return Response.json({ error: 'Not authorised to file comments.' }, { status: 403 });
      }
    }

    if (limit && !limit()) {
      return Response.json({ error: 'Rate limited — try again shortly.' }, { status: 429 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
    }

    const out = await createIssue(payload, {
      repo: config.repo || process.env.UI_COMMENTS_REPO,
      token: config.token || process.env.UI_COMMENTS_GH_TOKEN,
      label: config.label,
      titlePrefix: config.titlePrefix,
      assignees: config.assignees,
    });
    return Response.json(out.body, { status: out.status });
  };
}

module.exports = { createUiCommentRoute, createIssue };
