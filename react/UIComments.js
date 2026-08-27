'use client';

/*
 * React / Next.js client wrapper.
 *
 *   // app/layout.js  (inside <body>)
 *   import UIComments from 'ui-comments/react/UIComments';
 *   <UIComments endpoint="/api/ui-comment" project="rally" />
 *
 * Renders nothing itself — the client script owns its own DOM. Imported
 * dynamically so it never runs during SSR, and it self-guards against a
 * double init across Fast Refresh and route changes.
 */

import { useEffect } from 'react';

export default function UIComments({ endpoint = '/api/ui-comment', project = '', always = false, context = null }) {
  useEffect(() => {
    let cancelled = false;
    import('../client/ui-comments.js').then(() => {
      if (cancelled || !window.UIComments) {
        return;
      }
      window.UIComments.init({ endpoint, project, always, context });
    });
    return () => {
      cancelled = true;
    };
  }, [endpoint, project, always, context]);

  return null;
}
