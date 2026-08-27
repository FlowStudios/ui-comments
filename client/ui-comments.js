/*
 * ui-comments — click an element on a live page, leave a note, get a GitHub issue.
 *
 * Vanilla JS, zero dependencies, no build step. Works on any page (Next, PHP,
 * static HTML). All styling is inline or in one scoped <style> so it cannot be
 * inherited from — or leak into — the host page's CSS.
 *
 *   <script src="/ui-comments.js"></script>
 *   <script>UIComments.init({ endpoint: '/api/ui-comment' })</script>
 *
 * Off by default. Visit any page with ?uicomment=1 to arm it (sticky via
 * localStorage), ?uicomment=0 to disarm. Pass { always: true } to skip the gate.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'ui-comments';
  var NS = 'uic';
  var MAX_COMMENT = 4000;
  var MAX_HTML = 1200;
  var MAX_TEXT = 400;

  var state = {
    opts: null,
    on: false,          // comment mode engaged
    hover: null,        // element under the cursor
    picked: null,       // element frozen by a click
    root: null,         // our shadow-ish container
    box: null,          // highlight rectangle
    label: null,        // highlight tag label
    panel: null,        // the note composer
    sending: false,
  };

  /* ---------------------------------------------------------------- utils */

  function css(el, styles) {
    for (var k in styles) {
      if (Object.prototype.hasOwnProperty.call(styles, k)) {
        el.style[k] = styles[k];
      }
    }
    return el;
  }

  function make(tag, styles, text) {
    var el = document.createElement(tag);
    el.setAttribute('data-' + NS, '1');
    if (styles) {
      css(el, styles);
    }
    if (text != null) {
      el.textContent = text;
    }
    return el;
  }

  function ours(el) {
    return !!(el && el.closest && el.closest('[data-' + NS + '-root]'));
  }

  function clip(str, max) {
    if (!str) {
      return '';
    }
    var s = String(str).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  function classList(el) {
    // The full class attribute, verbatim — Josh's ask. Kept whole (not
    // deduped or sorted) because the order is how it reads in the source.
    var raw = el.getAttribute && el.getAttribute('class');
    return raw ? String(raw).replace(/\s+/g, ' ').trim() : '';
  }

  /* Escape a class/id for use inside a CSS selector. */
  function esc(ident) {
    if (global.CSS && global.CSS.escape) {
      return global.CSS.escape(ident);
    }
    return String(ident).replace(/([^\w-])/g, '\\$1');
  }

  /* One selector step: tag + #id, or tag + every class, + :nth-of-type when
     the element has same-tag siblings. */
  function step(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id) {
      return tag + '#' + esc(el.id);
    }
    var out = tag;
    var cls = classList(el);
    if (cls) {
      out += '.' + cls.split(' ').map(esc).join('.');
    }
    var parent = el.parentElement;
    if (parent) {
      var sibs = [];
      for (var i = 0; i < parent.children.length; i++) {
        if (parent.children[i].tagName === el.tagName) {
          sibs.push(parent.children[i]);
        }
      }
      if (sibs.length > 1) {
        out += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
      }
    }
    return out;
  }

  /* Walk up to <body>, stopping early at an id (ids are already unique). */
  function domPath(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      var s = step(node);
      parts.unshift(s);
      if (node.id) {
        break;
      }
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function selectorFor(el) {
    var path = domPath(el);
    var count = 0;
    try {
      count = document.querySelectorAll(path).length;
    } catch (err) {
      count = 0;
    }
    return { selector: path, matches: count, unique: count === 1 };
  }

  function describe(el) {
    var sel = selectorFor(el);
    var rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: classList(el),
      selector: sel.selector,
      selectorMatches: sel.matches,
      selectorUnique: sel.unique,
      text: clip(el.innerText || el.textContent, MAX_TEXT),
      html: clip(el.outerHTML, MAX_HTML),
      attrs: dataAttrs(el),
      rect: {
        x: Math.round(rect.left + global.scrollX),
        y: Math.round(rect.top + global.scrollY),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    };
  }

  /* data-* and aria-* survive minification, so they are the best source hints
     a prod bundle offers. */
  function dataAttrs(el) {
    var out = {};
    if (!el.attributes) {
      return out;
    }
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf('data-') === 0 || a.name.indexOf('aria-') === 0 || a.name === 'name' || a.name === 'href') {
        out[a.name] = clip(a.value, 200);
      }
    }
    return out;
  }

  function theme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr) {
      return attr;
    }
    if (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  function shortLabel(el) {
    var out = el.tagName.toLowerCase();
    if (el.id) {
      out += '#' + el.id;
    }
    var cls = classList(el);
    if (cls) {
      var first = cls.split(' ').slice(0, 3).join('.');
      out += '.' + first + (cls.split(' ').length > 3 ? '…' : '');
    }
    return out;
  }

  /* ------------------------------------------------------------------- ui */

  function mount() {
    if (state.root) {
      return;
    }
    var root = make('div');
    root.setAttribute('data-' + NS + '-root', '1');
    css(root, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483000',
      pointerEvents: 'none',
      font: '13px/1.45 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif',
      colorScheme: 'dark',
    });

    var style = document.createElement('style');
    style.setAttribute('data-' + NS, '1');
    style.textContent = [
      '[data-' + NS + '-root] *{box-sizing:border-box;margin:0;font-family:inherit}',
      'html[data-' + NS + '-active],html[data-' + NS + '-active] *{cursor:crosshair !important}',
      'html[data-' + NS + '-active] [data-' + NS + '-root] *{cursor:auto !important}',
      '[data-' + NS + '-root] textarea:focus,[data-' + NS + '-root] button:focus-visible{outline:2px solid #7c9cff;outline-offset:1px}',
    ].join('\n');
    document.head.appendChild(style);

    var box = make('div', {
      position: 'absolute',
      pointerEvents: 'none',
      border: '2px solid #7c9cff',
      background: 'rgba(124,156,255,.14)',
      borderRadius: '3px',
      display: 'none',
      transition: 'all .05s linear',
    });
    var label = make('div', {
      position: 'absolute',
      pointerEvents: 'none',
      display: 'none',
      padding: '2px 6px',
      borderRadius: '4px',
      background: '#7c9cff',
      color: '#0b1020',
      fontSize: '11px',
      fontWeight: '600',
      whiteSpace: 'nowrap',
      maxWidth: '60vw',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });

    root.appendChild(box);
    root.appendChild(label);
    document.body.appendChild(root);

    state.root = root;
    state.box = box;
    state.label = label;
  }

  function pill() {
    var btn = make('button', {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      pointerEvents: 'auto',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '7px',
      padding: '9px 14px',
      border: '1px solid rgba(255,255,255,.14)',
      borderRadius: '999px',
      background: '#171a24',
      color: '#e8eaf2',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 6px 22px rgba(0,0,0,.4)',
    });
    btn.type = 'button';
    btn.setAttribute('data-' + NS + '-pill', '1');
    btn.innerHTML = '<span style="font-size:14px">&#128172;</span><span data-' + NS + '-pill-text>Comment</span>';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    state.root.appendChild(btn);
    state.pillEl = btn;
    return btn;
  }

  function setPill(on) {
    if (!state.pillEl) {
      return;
    }
    var text = state.pillEl.querySelector('[data-' + NS + '-pill-text]');
    if (text) {
      text.textContent = on ? 'Pick an element — Esc to exit' : 'Comment';
    }
    css(state.pillEl, {
      background: on ? '#7c9cff' : '#171a24',
      color: on ? '#0b1020' : '#e8eaf2',
    });
  }

  function highlight(el) {
    if (!el) {
      css(state.box, { display: 'none' });
      css(state.label, { display: 'none' });
      return;
    }
    var r = el.getBoundingClientRect();
    css(state.box, {
      display: 'block',
      left: r.left + 'px',
      top: r.top + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
    });
    state.label.textContent = shortLabel(el);
    var above = r.top > 22;
    css(state.label, {
      display: 'block',
      left: Math.max(4, r.left) + 'px',
      top: (above ? r.top - 20 : r.bottom + 4) + 'px',
    });
  }

  function toast(msg, href) {
    var t = make('div', {
      position: 'fixed',
      right: '16px',
      bottom: '64px',
      pointerEvents: 'auto',
      maxWidth: '340px',
      padding: '10px 12px',
      borderRadius: '8px',
      background: '#171a24',
      color: '#e8eaf2',
      border: '1px solid rgba(255,255,255,.14)',
      boxShadow: '0 6px 22px rgba(0,0,0,.4)',
      fontSize: '12.5px',
    });
    t.textContent = msg;
    if (href) {
      t.appendChild(document.createTextNode(' '));
      var a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Open issue';
      css(a, { color: '#7c9cff', fontWeight: '600' });
      t.appendChild(a);
    }
    state.root.appendChild(t);
    global.setTimeout(function () {
      if (t.parentNode) {
        t.parentNode.removeChild(t);
      }
    }, href ? 12000 : 5000);
  }

  function closePanel() {
    if (state.panel && state.panel.parentNode) {
      state.panel.parentNode.removeChild(state.panel);
    }
    state.panel = null;
    state.picked = null;
    state.sending = false;
  }

  function openPanel(el) {
    closePanel();
    state.picked = el;
    highlight(el);

    var W = 320;
    var r = el.getBoundingClientRect();
    var left = Math.min(Math.max(8, r.left), global.innerWidth - W - 8);
    var below = r.bottom + 8;
    var top = below + 190 < global.innerHeight ? below : Math.max(8, r.top - 198);

    var panel = make('div', {
      position: 'fixed',
      left: left + 'px',
      top: top + 'px',
      width: W + 'px',
      pointerEvents: 'auto',
      padding: '10px',
      borderRadius: '10px',
      background: '#171a24',
      border: '1px solid rgba(255,255,255,.16)',
      boxShadow: '0 12px 40px rgba(0,0,0,.5)',
      color: '#e8eaf2',
    });

    var head = make('div', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      marginBottom: '7px',
    });
    var tag = make('code', {
      fontSize: '11px',
      color: '#9fb0ff',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontFamily: 'ui-monospace, Menlo, monospace',
    }, shortLabel(el));
    var up = make('button', {
      flex: '0 0 auto',
      padding: '2px 7px',
      fontSize: '11px',
      borderRadius: '5px',
      border: '1px solid rgba(255,255,255,.18)',
      background: 'transparent',
      color: '#c7ccdb',
      cursor: 'pointer',
    }, 'Parent ↑');
    up.type = 'button';
    up.title = 'Select the parent element (or press ↑)';
    up.addEventListener('click', function (e) {
      e.preventDefault();
      selectParent();
    });
    head.appendChild(tag);
    head.appendChild(up);

    var ta = make('textarea', {
      width: '100%',
      minHeight: '84px',
      resize: 'vertical',
      padding: '8px',
      borderRadius: '7px',
      border: '1px solid rgba(255,255,255,.18)',
      background: '#0f121a',
      color: '#e8eaf2',
      fontSize: '13px',
    });
    ta.placeholder = 'What should change about this element?';
    ta.maxLength = MAX_COMMENT;

    var foot = make('div', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: '7px',
      marginTop: '8px',
    });
    var cancel = make('button', {
      padding: '6px 11px',
      fontSize: '12px',
      borderRadius: '6px',
      border: '1px solid rgba(255,255,255,.18)',
      background: 'transparent',
      color: '#c7ccdb',
      cursor: 'pointer',
    }, 'Cancel');
    cancel.type = 'button';
    var send = make('button', {
      padding: '6px 13px',
      fontSize: '12px',
      fontWeight: '600',
      borderRadius: '6px',
      border: '0',
      background: '#7c9cff',
      color: '#0b1020',
      cursor: 'pointer',
    }, 'Create issue');
    send.type = 'button';

    cancel.addEventListener('click', function (e) {
      e.preventDefault();
      closePanel();
      highlight(null);
    });
    send.addEventListener('click', function (e) {
      e.preventDefault();
      submit(ta.value, send);
    });
    ta.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submit(ta.value, send);
      }
    });

    foot.appendChild(cancel);
    foot.appendChild(send);
    panel.appendChild(head);
    panel.appendChild(ta);
    panel.appendChild(foot);
    state.root.appendChild(panel);
    state.panel = panel;
    state.panelTag = tag;
    ta.focus();
  }

  function selectParent() {
    if (!state.picked || !state.picked.parentElement || state.picked.parentElement === document.body) {
      return;
    }
    var draft = state.panel ? state.panel.querySelector('textarea').value : '';
    var parent = state.picked.parentElement;
    openPanel(parent);
    if (draft && state.panel) {
      state.panel.querySelector('textarea').value = draft;
    }
  }

  /* --------------------------------------------------------------- submit */

  function payloadFor(el, comment) {
    return {
      comment: String(comment).slice(0, MAX_COMMENT),
      project: state.opts.project || '',
      page: {
        url: location.href,
        path: location.pathname + location.search,
        title: document.title,
      },
      viewport: {
        w: global.innerWidth,
        h: global.innerHeight,
        dpr: global.devicePixelRatio || 1,
        theme: theme(),
        scrollY: Math.round(global.scrollY),
      },
      element: describe(el),
      meta: {
        userAgent: navigator.userAgent,
        at: new Date().toISOString(),
      },
    };
  }

  function submit(comment, sendBtn) {
    if (state.sending) {
      return;
    }
    if (!comment || !comment.trim()) {
      toast('Add a note first.');
      return;
    }
    if (!state.picked) {
      return;
    }
    state.sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Creating…';

    var body = payloadFor(state.picked, comment);
    var extra = state.opts.context;
    if (typeof extra === 'function') {
      try {
        body.context = extra(state.picked);
      } catch (err) {
        body.context = { error: String(err) };
      }
    } else if (extra) {
      body.context = extra;
    }

    fetch(state.opts.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.json().then(function (json) {
          return { ok: res.ok, json: json };
        }).catch(function () {
          return { ok: false, json: { error: 'HTTP ' + res.status } };
        });
      })
      .then(function (out) {
        if (out.ok && out.json && out.json.url) {
          closePanel();
          highlight(null);
          toast('Issue #' + out.json.number + ' created.', out.json.url);
        } else {
          state.sending = false;
          sendBtn.disabled = false;
          sendBtn.textContent = 'Create issue';
          toast('Failed: ' + ((out.json && out.json.error) || 'unknown error'));
        }
      })
      .catch(function (err) {
        state.sending = false;
        sendBtn.disabled = false;
        sendBtn.textContent = 'Create issue';
        toast('Failed: ' + String(err.message || err));
      });
  }

  /* --------------------------------------------------------------- events */

  function onMove(e) {
    if (!state.on || state.picked || ours(e.target)) {
      return;
    }
    if (state.hover !== e.target) {
      state.hover = e.target;
      highlight(e.target);
    }
  }

  function onClick(e) {
    if (!state.on || ours(e.target)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    openPanel(e.target);
  }

  function onKey(e) {
    if (!state.on) {
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (state.panel) {
        closePanel();
        highlight(null);
      } else {
        toggle(false);
      }
      return;
    }
    if (e.key === 'ArrowUp' && state.panel && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      selectParent();
    }
  }

  function onScrollResize() {
    if (state.on && !state.panel && state.hover) {
      highlight(state.hover);
    }
  }

  /* Swallow the whole interaction layer while comment mode is on, so a click
     picks an element instead of navigating. Capture phase, before React. */
  var SWALLOW = ['mousedown', 'mouseup', 'dblclick', 'submit', 'pointerdown', 'pointerup'];

  function swallow(e) {
    if (state.on && !ours(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function toggle(force) {
    var next = typeof force === 'boolean' ? force : !state.on;
    state.on = next;
    if (!next) {
      closePanel();
      highlight(null);
      state.hover = null;
      document.documentElement.removeAttribute('data-' + NS + '-active');
    } else {
      document.documentElement.setAttribute('data-' + NS + '-active', '1');
    }
    setPill(next);
  }

  /* ----------------------------------------------------------------- init */

  function armed(opts) {
    if (opts.always) {
      return true;
    }
    var q = null;
    try {
      q = new URLSearchParams(location.search).get('uicomment');
    } catch (err) {
      q = null;
    }
    try {
      if (q === '1' || q === 'on') {
        localStorage.setItem(STORAGE_KEY, 'on');
        return true;
      }
      if (q === '0' || q === 'off') {
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }
      return localStorage.getItem(STORAGE_KEY) === 'on';
    } catch (err) {
      // Private mode / blocked storage: fall back to the query param alone.
      return q === '1' || q === 'on';
    }
  }

  var api = {
    init: function (opts) {
      opts = opts || {};
      if (global.__uiCommentsReady) {
        return api;
      }
      if (!opts.endpoint) {
        opts.endpoint = '/api/ui-comment';
      }
      if (!armed(opts)) {
        return api;
      }
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', function () {
          api.init(opts);
        });
        return api;
      }
      global.__uiCommentsReady = true;
      state.opts = opts;
      mount();
      pill();

      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
      global.addEventListener('scroll', onScrollResize, true);
      global.addEventListener('resize', onScrollResize);
      SWALLOW.forEach(function (name) {
        document.addEventListener(name, swallow, true);
      });
      return api;
    },
    toggle: toggle,
    enable: function () {
      try {
        localStorage.setItem(STORAGE_KEY, 'on');
      } catch (err) { /* ignore */ }
    },
    disable: function () {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (err) { /* ignore */ }
      toggle(false);
    },
    get armed() {
      return !!global.__uiCommentsReady;
    },
  };

  global.UIComments = api;

  /* Auto-init when loaded as <script src=... data-endpoint=...>. */
  var self = document.currentScript;
  if (self && self.hasAttribute('data-auto')) {
    api.init({
      endpoint: self.getAttribute('data-endpoint') || '/api/ui-comment',
      project: self.getAttribute('data-project') || '',
      always: self.getAttribute('data-always') === '1',
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof window !== 'undefined' ? window : globalThis));
