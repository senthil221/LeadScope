import Link from "next/link";
import {
  ArrowRight,
  Crosshair,
  Database,
  ShieldCheck,
  Search,
  Check,
} from "lucide-react";
export function SetupPage({ checks }: { checks: Record<string, boolean> }) {
  return (
    <main className="setup-layout">
      <section className="setup-brand">
        <div className="brand">
          <Crosshair size={29} />
          <span>
            LeadScope<span className="beta">BETA</span>
          </span>
        </div>
        <div>
          <span className="eyebrow light">
            YOUR AGENCY’S DISCOVERY WORKSPACE
          </span>
          <h1>
            Better evidence.
            <br />
            Better leads.
          </h1>
          <p>
            Discover public profile references, review the evidence, and build a
            list you can stand behind.
          </p>
          <div className="setup-steps">
            <span>
              01 <b>Define your audience</b>
            </span>
            <span>
              02 <b>Search with a clear budget</b>
            </span>
            <span>
              03 <b>Review, then export</b>
            </span>
          </div>
        </div>
        <small>Public search. Human judgment. Client by client.</small>
      </section>
      <section className="setup-content">
        <span className="pill">
          <Database size={14} /> Workspace setup
        </span>
        <h2>Connect your workspace</h2>
        <p className="muted">
          LeadScope is installed. Connect a dedicated Supabase database to start
          creating clients and campaigns.
        </p>
        <div className="card setup-checks">
          {Object.entries(checks).map(([name, ok]) => (
            <div key={name}>
              <span>{name}</span>
              <span className={ok ? "configured" : "missing"}>
                {ok ? (
                  <>
                    <Check size={14} /> Configured
                  </>
                ) : (
                  "Not configured"
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="notice">
          <ShieldCheck size={20} />
          <div>
            <strong>Set up once, on the server</strong>
            <p>
              Add the variables from <code>.env.example</code> to{" "}
              <code>.env.local</code>, apply the migration, and create your email
              and password account. The README includes each step.
            </p>
          </div>
        </div>
        <div className="setup-footer">
          <Search size={17} />
          <span>
            No search requests have been made. Live search is disabled by
            default.
          </span>
        </div>
        <Link className="button primary" href="/clients">
          Check configuration <ArrowRight size={16} />
        </Link>
      </section>
    </main>
  );
}
export function AccessPage({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <main className="access-page">
      <div className="brand">
        <Crosshair />
        <span>LeadScope</span>
      </div>
      <section className="card">
        <ShieldCheck size={32} />
        <h1>{title}</h1>
        <p className="muted">{message}</p>
        <Link className="button" href="/clients">
          Try again
        </Link>
        <form action="/auth/logout" method="post">
          <button className="text-button">Sign out</button>
        </form>
      </section>
    </main>
  );
}
