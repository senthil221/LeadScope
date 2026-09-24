// A mobile number is ten digits.
//
// This replaced a country picker with twenty-eight entries and a dial code on
// every stored number. Every candidate in this database is in India, so the
// picker asked a question with one answer and then made somebody answer it
// anyway. Ten digits is not a worldwide rule — China is eleven, Singapore
// eight, the UAE nine — so a number from outside India cannot be recorded
// until this is revisited, which is a deliberate trade, not an oversight.
//
// Input is read generously and stored strictly: spaces, dashes and brackets
// come off, and so does a +91, a 91 or a leading 0, because that is how
// numbers arrive when they are pasted out of a CV or a spreadsheet. What
// lands in the column is always the bare ten digits.

const MOBILE_DIGITS = 10;

export function isMobileNumber(value: string): boolean {
  return new RegExp(`^\\d{${MOBILE_DIGITS}}$`).test(value);
}

/** Strips the punctuation and country prefixes a pasted number arrives with. */
export function mobileDigits(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === MOBILE_DIGITS) return digits;
  // 0 98765 43210, 91 98765 43210, +91 98765 43210 — all the same number.
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

export function normalizeCandidatePhone(input: string): {
  value: string | null;
  error: string | null;
} {
  const trimmed = input.trim();
  if (!trimmed) return { value: null, error: null };
  if (/[A-Za-z]/.test(trimmed))
    return { value: null, error: "Use digits only for the mobile number." };
  const digits = mobileDigits(trimmed);
  if (!isMobileNumber(digits))
    return { value: null, error: "Enter a 10 digit mobile number." };
  return { value: digits, error: null };
}

/** What to show in a cell: grouped for reading, never for storing. */
export function formatMobile(value: string): string {
  return isMobileNumber(value) ? `${value.slice(0, 5)} ${value.slice(5)}` : value;
}

export function normalizeCandidateEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254) return null;
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email) ? email : null;
}
