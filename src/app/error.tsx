"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="access-page">
      <section className="card">
        <h1>Something didn’t load</h1>
        <p>
          Check your connection and try again. Your saved work is still in the
          database.
        </p>
        <button onClick={reset}>Try again</button>
        <Link className="button" href="/clients">
          Go to clients
        </Link>
      </section>
    </main>
  );
}
