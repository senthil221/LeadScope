"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
export function LoginForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [pending, setPending] = useState(false);
  return (
    <>
      <form
        action="/auth/login"
        method="post"
        onSubmit={() => setPending(true)}
      >
        <input type="hidden" name="mode" value={mode} />
        <label>
          Email address
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
          />
          <small>
            {mode === "signup"
              ? "Use at least 8 characters. Your agency must approve access."
              : "Your LeadScope account password."}
          </small>
        </label>
        <button disabled={pending} className="primary wide">
          {pending
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
          <ArrowRight size={17} />
        </button>
      </form>
      <button
        className="text-button wide"
        disabled={pending}
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
      >
        {mode === "signin"
          ? "New operator? Create an account"
          : "Already registered? Sign in"}
      </button>
    </>
  );
}
