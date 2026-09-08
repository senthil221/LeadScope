export default function Loading() {
  return (
    <div
      className="workspace-loading"
      role="status"
      aria-label="Loading workspace"
    >
      <div className="loading-line" />
      <div className="loading-line short" />
      <div className="loading-table">Loading workspace…</div>
    </div>
  );
}
