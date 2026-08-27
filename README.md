# ui-comments

Claude Design's COMMENT button, for sites that already shipped.

Arm the page, click the **Comment** pill, hover any element (it highlights),
click it, type what should change. A GitHub issue is created with the page URL,
the element's full class list, a `nth-of-type` DOM path, its text, and its
rendered HTML — everything needed to find it in source without the browser
session that filed it.

Zero dependencies. One vanilla client script plus a server endpoint. Works on
Next.js, plain PHP, or a static page.

## How the element gets identified

There is no source map from a rendered DOM node back to a template, so the
issue carries the identification handles instead:

| Handle | Why |
|---|---|
| Page URL + path | narrows to one route/template |
| **Full class attribute** | verbatim, in source order |
| DOM path with `:nth-of-type` | disambiguates when the classes are shared utilities |
| Text content | usually the thing that actually pins it down — grep for it |
| `data-*` / `aria-*` / `name` / `href` | survive minification |
| Rendered outerHTML | sanity check you found the right node |

The issue warns when the generated selector matches more than one element, so
you know not to trust it alone.

Want an exact file and line? Stamp `data-src="File.tsx:112"` on your components
at build time — the client forwards every `data-*` attribute automatically, so
no client change is needed.

## Versioning

Bump `version` in `package.json` on every change. Webpack (and so Next) snapshots
`node_modules` by package version, not by file contents — a same-version
reinstall is served from `.next/cache` and your fix silently does not ship.

## Install

```bash
npm i github:FlowStudios/ui-comments
```

Or copy `client/ui-comments.js` into your `public/` folder and skip npm.

## Next.js (App Router)

```js
// app/api/ui-comment/route.js
import { createUiCommentRoute } from 'ui-comments/server/next-route';
export const POST = createUiCommentRoute();
```

```jsx
// app/layout.js — inside <body>
import UIComments from 'ui-comments/react/UIComments';
...
<UIComments endpoint="/api/ui-comment" project="rally" />
```

```bash
# .env / pm2 env — server-side only, never NEXT_PUBLIC_
UI_COMMENTS_REPO=FlowStudios/rally
UI_COMMENTS_GH_TOKEN=github_pat_...
UI_COMMENTS_KEY=some-long-random-string
```

## PHP

Copy `server/php/ui-comments.php` and `client/ui-comments.js` to the site, then
in your template:

```html
<script src="/ui-comments.js" data-auto data-endpoint="/ui-comments.php" data-project="portal"></script>
```

Define `UI_COMMENTS_REPO` and `UI_COMMENTS_GH_TOKEN` in an already-included
secrets file (the portal's `configurations/db/config.php`), not in the endpoint.

## Any other site

```html
<script src="/ui-comments.js"></script>
<script>UIComments.init({ endpoint: '/api/ui-comment', project: 'mysite' });</script>
```

## Arming it

Off by default, so staff and customers never see the pill.

| | |
|---|---|
| `?uicomment=1&uickey=SECRET` | arm it — sticky per browser via `localStorage` |
| `?uicomment=0` | disarm, and forget the key |
| `UIComments.init({ always: true })` | always show the pill (dev, or an app with its own auth) |

## Locking the endpoint down

**Read this before mounting it on a site without a login.** The endpoint writes
to your issue tracker, so an open one is an invitation to spam it.

Pass `requireKey: true` and the route refuses every request with a 503 while
`UI_COMMENTS_KEY` is unset — so a forgotten env var fails shut instead of
leaving the tracker open. Set it on any app without its own login.

Set `UI_COMMENTS_KEY` and the endpoint rejects anything without a matching
`X-UI-Comments-Key` header (sha256 + constant-time compare). The client picks
the key up from the arming URL once and keeps it in `localStorage` — so the
secret is never in your repo, never in your client bundle, and someone probing
`/api/ui-comment` cannot guess it. Hand out the arming link, not the key.

The Next adapter also caps issues per process (20 per 10 minutes by default;
`rateLimit: { max, windowMs }`, or `null` to turn it off), so a leaked link
cannot file a thousand issues before you notice.

If the app already has auth, put the route behind it and skip the key.

## Keys

| | |
|---|---|
| click | pick the element under the cursor |
| `↑` / **Parent ↑** | walk up to the container (draft is kept) |
| `⌘/Ctrl` + `Enter` | create the issue |
| `Esc` | close the note, then exit comment mode |

## Standing instructions

Every issue can open with a blockquote telling whoever picks it up how the repo
expects to be worked — so an agent handed nothing but the issue URL still has
its bearings. Set `instructions` (or `$UI_COMMENTS_INSTRUCTIONS`), newlines
allowed:

```js
export const POST = createUiCommentRoute({
  instructions: [
    'Read the repo README and CLAUDE.md before editing.',
    'Reproduce on the live page first, then fix at the component level.',
    'Comment on this issue with what you found, and close it from the PR.',
  ].join('\n'),
});
```

Keep it a pointer, not a manual — it is repeated on every issue, and the repo's
own docs are the detail.

## Extra context

Pass `context` to attach app state (current user, tenant, feature flags) to
every issue — an object, or a function receiving the clicked element:

```jsx
<UIComments context={(el) => ({ tenant: currentTenant, route: pathname })} />
```

## Working the queue

```bash
gh issue list --label ui-comment
gh issue view 42
```

Point Claude Code at one and it has the URL, classes, text, and HTML it needs
to grep for the component. Close the issue in the PR body with
`Closes #42`.

## The token

A fine-grained PAT scoped to the one repo, **Issues: Read and write** only.
It lives in server env, never in client JS — the client only ever talks to your
own endpoint.

## Configuration

`createUiCommentRoute(config)` and `createIssue(payload, config)` accept:

| Option | Default | |
|---|---|---|
| `repo` | `$UI_COMMENTS_REPO` | `owner/repo` |
| `token` | `$UI_COMMENTS_GH_TOKEN` | fine-grained PAT |
| `key` | `$UI_COMMENTS_KEY` | shared secret; unset = open endpoint |
| `requireKey` | `false` | 503 rather than run open |
| `instructions` | `$UI_COMMENTS_INSTRUCTIONS` | blockquote above every note |
| `rateLimit` | 20 / 10 min | `{ max, windowMs }`, or `null` |
| `label` | `ui-comment` | created if missing; `null` for none |
| `titlePrefix` | `[UI] ` | |
| `assignees` | — | array of logins |
