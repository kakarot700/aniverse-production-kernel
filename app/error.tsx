'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Route-level error boundary.
 *
 * The catalog degrades through three providers before it can fail, so
 * reaching this screen means something structural broke rather than a
 * provider being down. `reset()` re-renders the segment without a full reload.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Aniverse route error:', error);
  }, [error]);

  return (
    <div className="site-shell">
      <div className="mesh-backdrop" aria-hidden="true" />
      <main id="top">
        <section className="boundary" role="alert">
          <p className="eyebrow">Something went wrong</p>
          <h1>That page could not be rendered.</h1>
          <p>
            The catalog falls back through AniList, Jikan, and a bundled offline dataset, so this is unlikely to be a
            provider outage. Try again, and check the server logs if it repeats.
          </p>
          {error.digest ? <p className="boundary-digest">Reference: {error.digest}</p> : null}
          <div className="boundary-actions">
            <button className="button-primary" type="button" onClick={reset}>
              Try again
            </button>
            <Link className="button-quiet" href="/">
              Back to the catalog
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
