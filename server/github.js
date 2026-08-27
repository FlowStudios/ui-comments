/*
 * ui-comments server core — turn a client payload into a GitHub issue.
 *
 * Framework-agnostic: no request/response objects, just data in and data out,
 * so the same logic serves a Next route handler, an Express route, or a
 * Lambda. Node 18+ (uses global fetch).
 */

'use strict';

const API = 'https://api.github.com';
const MAX_COMMENT = 4000;
const DEFAULT_LABEL = 'ui-comment';

function truncate(str, max) {
  const s = String(str == null ? '' : str);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/* First line of the note becomes the title. Newlines and backticks out, so a
   pasted multi-line note cannot smuggle markdown into the title. */
function titleFrom(comment, prefix) {
  const first = String(comment).split('\n').find((l) => l.trim()) || 'UI comment';
  const clean = first.replace(/[`\r]/g, '').trim();
  return `${prefix}${truncate(clean, 80)}`;
}

function fence(lang, body) {
  return ['```' + lang, body, '```'].join('\n');
}

function kv(rows) {
  const lines = ['| | |', '|---|---|'];
  for (const [k, v] of rows) {
    if (v !== '' && v != null) {
      lines.push(`| **${k}** | ${String(v).replace(/\|/g, '\\|')} |`);
    }
  }
  return lines.join('\n');
}

/* Shell-quote for single quotes. */
function sq(str) {
  return `'${String(str).replace(/'/g, "'\\''")}'`;
}

/* A ready-to-run search for whoever opens the issue. Text content beats class
   names on a utility-class codebase — 'd-flex mb-3' matches everything, the
   copy matches one component. A data-* attribute, when present, beats both. */
function grepHint(el) {
  const lines = [];
  const attrs = el.attrs || {};
  const named = Object.keys(attrs).filter((k) => k.indexOf('data-') === 0);

  if (named.length) {
    lines.push(`rg -n ${sq(named[0])} --glob '!node_modules'`);
  }
  if (el.text) {
    // A few words is enough, and short enough to survive line wrapping in JSX.
    const words = el.text.split(' ').slice(0, 6).join(' ');
    lines.push(`rg -n ${sq(words)} --glob '!node_modules'`);
  }
  if (el.classes) {
    const distinct = el.classes.split(' ').filter((c) => c.indexOf('-') > 0);
    const pick = distinct.length ? distinct[0] : el.classes.split(' ')[0];
    if (pick) {
      lines.push(`rg -n ${sq(pick)} --glob '!node_modules'`);
    }
  }
  return lines.join('\n');
}

/* The issue body is written for whoever picks the issue up — a person or
   Claude Code. Everything needed to locate the element in source, nothing
   that needs the original browser session. */
function bodyFrom(p) {
  const el = p.element || {};
  const page = p.page || {};
  const vp = p.viewport || {};
  const rect = el.rect || {};
  const attrs = el.attrs || {};
  const attrRows = Object.keys(attrs).map((k) => [k, `\`${attrs[k]}\``]);

  const out = [];
  out.push(truncate(p.comment, MAX_COMMENT));
  out.push('');
  out.push('---');
  out.push('');
  out.push('### Element');
  out.push('');
  out.push(kv([
    ['Page', page.url ? `[\`${page.path || page.url}\`](${page.url})` : ''],
    ['Tag', el.tag ? `\`<${el.tag}>\`` : ''],
    ['Id', el.id ? `\`${el.id}\`` : ''],
    ['Classes', el.classes ? `\`${el.classes}\`` : '_(none)_'],
    ['Text', el.text ? `“${truncate(el.text, 200)}”` : '_(none)_'],
    ...attrRows,
  ]));
  out.push('');
  out.push('**Selector**' + (el.selectorUnique === false ? ` — ⚠️ matches ${el.selectorMatches} elements, not unique` : ''));
  out.push('');
  out.push(fence('css', el.selector || '(none)'));
  out.push('');

  if (el.html) {
    out.push('**Rendered HTML**');
    out.push('');
    out.push(fence('html', el.html));
    out.push('');
  }

  out.push('### Context');
  out.push('');
  out.push(kv([
    ['Title', page.title],
    ['Theme', vp.theme],
    ['Viewport', vp.w ? `${vp.w}×${vp.h} @${vp.dpr}x` : ''],
    ['Element box', rect.w != null ? `${rect.w}×${rect.h} at (${rect.x}, ${rect.y})` : ''],
    ['Reported', p.meta && p.meta.at],
    ['Project', p.project],
  ]));

  if (p.context) {
    out.push('');
    out.push('<details><summary>App context</summary>');
    out.push('');
    out.push(fence('json', JSON.stringify(p.context, null, 2)));
    out.push('');
    out.push('</details>');
  }

  const hint = grepHint(el);
  if (hint) {
    out.push('');
    out.push('### Finding it in source');
    out.push('');
    out.push(fence('bash', hint));
  }

  out.push('');
  out.push('<sub>Filed from the live page with [ui-comments](https://github.com/FlowStudios/ui-comments). '
    + 'The class list and selector above are the identification handle — there is no source map from a '
    + 'rendered node back to a template.</sub>');

  return out.join('\n');
}

function validate(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Malformed payload.';
  }
  if (!payload.comment || !String(payload.comment).trim()) {
    return 'Comment is required.';
  }
  if (String(payload.comment).length > MAX_COMMENT * 2) {
    return 'Comment too long.';
  }
  if (!payload.element || !payload.element.tag) {
    return 'Element details are required.';
  }
  return null;
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'ui-comments',
  };
}

/* Creating an issue with an unknown label 422s, so make sure it exists.
   Failure here is not fatal — we would rather file an unlabelled issue. */
async function ensureLabel(repo, token, label) {
  const url = `${API}/repos/${repo}/labels/${encodeURIComponent(label)}`;
  const res = await fetch(url, { headers: headers(token) });
  if (res.ok) {
    return true;
  }
  if (res.status !== 404) {
    return false;
  }
  const created = await fetch(`${API}/repos/${repo}/labels`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      name: label,
      color: '7c9cff',
      description: 'Filed from a live page with ui-comments',
    }),
  });
  return created.ok;
}

/**
 * @param {object} payload  the client POST body
 * @param {object} config   { repo, token, label?, titlePrefix?, assignees? }
 * @returns {Promise<{status:number, body:object}>}
 */
async function createIssue(payload, config) {
  const repo = config && config.repo;
  const token = config && config.token;

  if (!repo || !token) {
    return { status: 500, body: { error: 'ui-comments is not configured (repo/token missing).' } };
  }

  const bad = validate(payload);
  if (bad) {
    return { status: 400, body: { error: bad } };
  }

  const label = config.label === null ? null : (config.label || DEFAULT_LABEL);
  const labels = [];
  if (label) {
    const ok = await ensureLabel(repo, token, label);
    if (ok) {
      labels.push(label);
    }
  }

  const issue = {
    title: titleFrom(payload.comment, config.titlePrefix != null ? config.titlePrefix : '[UI] '),
    body: bodyFrom(payload),
  };
  if (labels.length) {
    issue.labels = labels;
  }
  if (config.assignees && config.assignees.length) {
    issue.assignees = config.assignees;
  }

  const res = await fetch(`${API}/repos/${repo}/issues`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(issue),
  });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    return {
      status: res.status === 401 || res.status === 403 ? 502 : res.status,
      body: { error: json.message || `GitHub returned ${res.status}` },
    };
  }

  return { status: 201, body: { ok: true, number: json.number, url: json.html_url } };
}

module.exports = { createIssue, bodyFrom, titleFrom, validate };
