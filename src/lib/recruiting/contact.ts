export type PhoneCountry = {
  iso: string;
  name: string;
  dialCode: `+${string}`;
  minDigits: number;
  maxDigits: number;
  example: string;
};

// Common recruiting markets are listed explicitly so validation remains
// deterministic in every browser and does not depend on a third-party API.
export const phoneCountries: readonly PhoneCountry[] = [
  { iso: "IN", name: "India", dialCode: "+91", minDigits: 10, maxDigits: 10, example: "98765 43210" },
  { iso: "US", name: "United States", dialCode: "+1", minDigits: 10, maxDigits: 10, example: "415 555 0123" },
  { iso: "CA", name: "Canada", dialCode: "+1", minDigits: 10, maxDigits: 10, example: "416 555 0123" },
  { iso: "GB", name: "United Kingdom", dialCode: "+44", minDigits: 10, maxDigits: 10, example: "7400 123456" },
  { iso: "AE", name: "United Arab Emirates", dialCode: "+971", minDigits: 9, maxDigits: 9, example: "50 123 4567" },
  { iso: "SG", name: "Singapore", dialCode: "+65", minDigits: 8, maxDigits: 8, example: "8123 4567" },
  { iso: "AU", name: "Australia", dialCode: "+61", minDigits: 9, maxDigits: 9, example: "412 345 678" },
  { iso: "DE", name: "Germany", dialCode: "+49", minDigits: 7, maxDigits: 11, example: "1512 3456789" },
  { iso: "FR", name: "France", dialCode: "+33", minDigits: 9, maxDigits: 9, example: "6 12 34 56 78" },
  { iso: "NL", name: "Netherlands", dialCode: "+31", minDigits: 9, maxDigits: 9, example: "6 12345678" },
  { iso: "IE", name: "Ireland", dialCode: "+353", minDigits: 9, maxDigits: 9, example: "85 123 4567" },
  { iso: "NZ", name: "New Zealand", dialCode: "+64", minDigits: 8, maxDigits: 10, example: "21 123 4567" },
  { iso: "ZA", name: "South Africa", dialCode: "+27", minDigits: 9, maxDigits: 9, example: "82 123 4567" },
  { iso: "SA", name: "Saudi Arabia", dialCode: "+966", minDigits: 9, maxDigits: 9, example: "50 123 4567" },
  { iso: "QA", name: "Qatar", dialCode: "+974", minDigits: 8, maxDigits: 8, example: "3312 3456" },
  { iso: "MY", name: "Malaysia", dialCode: "+60", minDigits: 9, maxDigits: 10, example: "12 345 6789" },
  { iso: "ID", name: "Indonesia", dialCode: "+62", minDigits: 9, maxDigits: 12, example: "812 3456 7890" },
  { iso: "PH", name: "Philippines", dialCode: "+63", minDigits: 10, maxDigits: 10, example: "917 123 4567" },
  { iso: "LK", name: "Sri Lanka", dialCode: "+94", minDigits: 9, maxDigits: 9, example: "77 123 4567" },
  { iso: "BD", name: "Bangladesh", dialCode: "+880", minDigits: 10, maxDigits: 10, example: "1712 345678" },
  { iso: "PK", name: "Pakistan", dialCode: "+92", minDigits: 10, maxDigits: 10, example: "300 1234567" },
  { iso: "NP", name: "Nepal", dialCode: "+977", minDigits: 10, maxDigits: 10, example: "9812 345678" },
  { iso: "CN", name: "China", dialCode: "+86", minDigits: 11, maxDigits: 11, example: "138 0013 8000" },
  { iso: "JP", name: "Japan", dialCode: "+81", minDigits: 10, maxDigits: 10, example: "90 1234 5678" },
  { iso: "KR", name: "South Korea", dialCode: "+82", minDigits: 9, maxDigits: 10, example: "10 1234 5678" },
  { iso: "HK", name: "Hong Kong", dialCode: "+852", minDigits: 8, maxDigits: 8, example: "5123 4567" },
  { iso: "BR", name: "Brazil", dialCode: "+55", minDigits: 10, maxDigits: 11, example: "11 91234 5678" },
  { iso: "MX", name: "Mexico", dialCode: "+52", minDigits: 10, maxDigits: 10, example: "55 1234 5678" },
];

export const defaultPhoneCountry = "IN";

export function getPhoneCountry(iso: string): PhoneCountry {
  return phoneCountries.find((country) => country.iso === iso) ?? phoneCountries[0];
}

export function parseStoredPhone(value: string | null | undefined): {
  countryIso: string;
  nationalNumber: string;
} {
  const input = value?.trim() ?? "";
  if (!input.startsWith("+")) {
    return {
      countryIso: defaultPhoneCountry,
      nationalNumber: input.replace(/\D/g, ""),
    };
  }
  const digits = input.slice(1).replace(/\D/g, "");
  const country = [...phoneCountries]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((option) => digits.startsWith(option.dialCode.slice(1)));
  if (!country) {
    return { countryIso: defaultPhoneCountry, nationalNumber: digits };
  }
  return {
    countryIso: country.iso,
    nationalNumber: digits.slice(country.dialCode.length - 1),
  };
}

export function normalizeCandidatePhone(
  countryIso: string,
  nationalInput: string,
): { value: string | null; error: string | null } {
  const country = getPhoneCountry(countryIso);
  const trimmed = nationalInput.trim();
  if (!trimmed) return { value: null, error: null };
  if (/[A-Za-z]/.test(trimmed)) {
    return { value: null, error: "Use digits only for the phone number." };
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < country.minDigits || digits.length > country.maxDigits) {
    const required = country.minDigits === country.maxDigits
      ? `${country.minDigits} digits`
      : `${country.minDigits}–${country.maxDigits} digits`;
    return {
      value: null,
      error: `${country.name} numbers need ${required} after ${country.dialCode}.`,
    };
  }
  const value = `${country.dialCode}${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    return { value: null, error: "Enter a valid international phone number." };
  }
  return { value, error: null };
}

export function normalizeCandidateEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254) return null;
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email) ? email : null;
}

export function isE164Phone(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}
