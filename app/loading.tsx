/** Streamed shell shown while the home page resolves its first catalog page. */
export default function Loading() {
  return (
    <div className="site-shell">
      <div className="mesh-backdrop" aria-hidden="true" />
      <main id="top">
        <section className="hero" aria-hidden="true">
          <div className="hero-copy">
            <p className="eyebrow">Loading</p>
            <h1 id="hero-title">Find your next little world.</h1>
          </div>
          <div className="hero-art hero-art-skeleton" />
        </section>
        <section className="collection">
          <span className="sr-only" role="status">
            Loading the catalog…
          </span>
          <div className="catalog-grid" aria-hidden="true">
            {Array.from({ length: 12 }, (_unused, index) => (
              <div key={index} className="card-skeleton" />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
