export default function Loading() {
  return (
    <main className="route-loading" role="status" aria-label="Loading workspace">
      <div className="route-loading-sidebar" aria-hidden="true">
        <span className="route-loading-brand" />
        <span />
        <span />
        <span />
      </div>
      <section className="route-loading-content" aria-live="polite">
        <span className="route-loading-header" />
        <div className="route-loading-page">
          <span className="route-loading-kicker" />
          <span className="route-loading-title" />
          <span className="route-loading-copy" />
          <div className="route-loading-cards">
            <span />
            <span />
            <span />
          </div>
        </div>
        <span className="sr-only">Loading workspace</span>
      </section>
    </main>
  );
}
