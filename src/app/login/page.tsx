import { Crosshair, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { setup } from "@/lib/server/config";
import { SetupPage } from "@/components/setup";
export const dynamic = "force-dynamic";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const env = setup();
  if (!env.database) return <SetupPage checks={env.checks} />;
  const params = await searchParams;
  return (
    <main className="login-page">
      <div className="brand">
        <Crosshair size={30} />
        LeadScope <span className="beta">BETA</span>
      </div>
      <section className="card">
        <span className="eyebrow">AGENCY WORKSPACE</span>
        <h1>
          Your next great list
          <br />
          starts here.
        </h1>
        <p className="muted">
          Sign in to discover and review leads for your clients.
        </p>
        {params.error && (
          <p role="alert" className="error">
            {params.error === "signup"
              ? "Account creation did not complete. Check the email and password, or ask your agency administrator to create your account."
              : params.error === "invalid"
                ? "Enter a valid email and a password with at least 8 characters."
                : "Sign-in did not complete. Check your email and password and confirm your email if required."}
          </p>
        )}
        {params.message === "confirm" && (
          <p className="notice">
            If this email can be registered, a confirmation link has been sent.
            Confirm your email, then sign in. Your account also needs agency
            approval.
          </p>
        )}
        <LoginForm />
        <p className="login-note">
          <ShieldCheck size={16} /> Access is limited to approved agency
          operators.
        </p>
      </section>
      <small>Evidence-led discovery. Human-reviewed results.</small>
    </main>
  );
}
