"use client";
import { isMobileNumber, mobileDigits } from "@/lib/recruiting/contact";

// One mobile number. Ten digits, no country to pick, and the same field in the
// add dialog and the candidate drawer so the two cannot drift apart.
//
// Digits only go in: a paste out of a CV brings +91, spaces, dashes and
// brackets with it, and making somebody delete those by hand to satisfy a
// form is the kind of small tax that gets a field left empty instead.
export function MobileField({
  label,
  value,
  disabled,
  duplicate = false,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  /** The other number on this candidate is already this one. */
  duplicate?: boolean;
  onChange: (value: string) => void;
}) {
  const digits = mobileDigits(value);
  const short = Boolean(value) && !isMobileNumber(digits);
  const error = duplicate
    ? "This is the same as the other number."
    : short
      ? `${digits.length} of 10 digits.`
      : "";
  return (
    <label className="mobile-field">
      {/* One flex row: a bare text node beside a span are two items of the
          column the global label style sets up, which put "optional" on a
          line of its own. */}
      <span className="mobile-field-label">
        {label} <span className="optional">optional</span>
      </span>
      <input
        aria-invalid={Boolean(error)}
        autoComplete="off"
        className={error ? "is-invalid" : undefined}
        disabled={disabled}
        inputMode="numeric"
        // Room for a pasted +91 and its spaces; what is kept is the ten digits.
        maxLength={20}
        placeholder="98765 43210"
        type="tel"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => onChange(digits.slice(0, 10))}
      />
      {error && <small className="candidate-field-help field-error-text">{error}</small>}
    </label>
  );
}
