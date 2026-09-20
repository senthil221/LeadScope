"use client";

export async function act<T = unknown>(
  action: string,
  payload: unknown = {},
  fallbackError = "The action failed. Try again.",
): Promise<T> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? fallbackError);
  return result as T;
}
