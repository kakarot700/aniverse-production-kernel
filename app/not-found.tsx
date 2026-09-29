import Link from 'next/link';

/** 404 for unknown routes. */
export default function NotFound() {
  return (
    <div className="site-shell">
      <div className="mesh-backdrop" aria-hidden="true" />
      <main id="top">
        <section className="boundary">
          <p className="eyebrow">404</p>
          <h1>There is nothing at this address.</h1>
          <p>The page you asked for does not exist. The catalog is where everything lives.</p>
          <div className="boundary-actions">
            <Link className="button-primary" href="/">
              Back to the catalog
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
