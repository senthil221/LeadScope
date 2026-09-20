import { test, expect } from "@playwright/test";

// Unauthenticated coverage only. Authenticated flows (client -> role ->
// candidate import -> stage move) need a real approved operator account and
// are intentionally not written here yet — see e2e/README.md.

test("redirects an unauthenticated visitor to sign in", async ({ page }) => {
  await page.goto("/clients");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /recruiting pipeline/i })).toBeVisible();
});

test("rejects a malformed sign-in without reaching the workspace", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("not-an-email");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("toggles between sign-in and create-account modes", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: "New operator? Create an account" }).click();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  await page.getByRole("button", { name: "Already registered? Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
