import Link from "next/link";
export default function NotFound() {
  return (
    <main className="access-page">
      <section className="card">
        <h1>Workspace not found</h1>
        <p>This page may have moved or the link may be incomplete.</p>
        <Link className="button primary" href="/clients">
          Back to clients
        </Link>
      </section>
    </main>
  );
}
