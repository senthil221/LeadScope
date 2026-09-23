import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import logo from "@/assets/brand/leadvance-recruiting.png";
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
        <Image
          src={logo}
          alt="Leadvance Recruiting"
          className="login-logo"
          priority
          unoptimized
        />
      </div>
      <section className="card">
        <span className="eyebrow">RECRUITING CRM</span>
        <h1>
          Run your recruiting
          <br />
          pipeline with clarity.
        </h1>
        <p className="muted">
          Sign in to manage candidates, shortlists, and client decisions.
        </p>
        {params.error && (
          <p role="alert" className="error">
            {params.error === "connection"
              ? "Cannot reach the sign-in service right now. Please try again shortly."
              : params.error === "unconfirmed"
                ? "Confirm your email using the link in your inbox, then sign in."
                : params.error === "signup"
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
        {/* Creating an account is not something a visitor to the sign-in page
            should be invited to do: every account still needs approving, and
            the offer only produced accounts to turn down. It stays reachable
            at /login?signup=1, which is the link to send a new operator. */}
        <LoginForm allowSignup={params.signup === "1"} />
        <p className="login-note">
          <ShieldCheck size={16} /> Access is limited to approved agency
          operators.
        </p>
      </section>
      <small>Candidate review for modern recruiting teams.</small>
    </main>
  );
}
