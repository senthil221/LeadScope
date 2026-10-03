// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InlineMobileLookup } from "../src/components/recruiting/inline-mobile-lookup";
import type { MobileJob } from "../src/lib/recruiting/mobile-waterfall";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const props = { roleId: "role", candidateId: "profile", linkedin: "https://www.linkedin.com/in/person", onQueued: vi.fn(), onSaved: vi.fn() };
const job: MobileJob = { id: "job", candidate_id: "profile", candidate_name: "Person", status: "running", provider_index: 1, collect_all: false, results: [], steps: [], error_code: null, created_at: "2026-10-03T12:00:00Z", updated_at: "2026-10-03T12:00:00Z" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const status = (jobs: MobileJob[] = []) => ({ jobs, workerOnline: true });
async function mount(overrides: Partial<typeof props> = {}) {
  let view: ReturnType<typeof render>;
  await act(async () => { view = render(<InlineMobileLookup {...props} {...overrides} />); });
  return view!;
}

describe("mobile enrichment inside a phone cell", () => {
  it("only reads history on opening; Enrich explicitly queues the profile once", async () => {
    let release!: (value: Response) => void;
    const fetcher = vi.fn((_url, init) => init?.method === "POST"
      ? new Promise<Response>((resolve) => { release = resolve; })
      : Promise.resolve(json(status())));
    vi.stubGlobal("fetch", fetcher);
    const onQueued = vi.fn();
    await mount({ onQueued });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("candidate=profile");
    expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Enrich" }));
    fireEvent.click(screen.getByRole("button", { name: "Enrich" }));
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1].body)).toEqual({ role: "role", candidates: ["profile"], collectAll: false });
    await act(async () => { release(json({ queued: 1, alreadyRunning: 0, missingLinkedIn: 0 })); });
    expect(onQueued).toHaveBeenCalledTimes(1);
  });

  it("keeps the running lookup in the cell, refreshes zero results, and stops detail polling on completion", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(status([job])))
      .mockResolvedValueOnce(json(status([{ ...job, status: "no_mobile", provider_index: 4, updated_at: "2026-10-03T12:03:00Z" }])));
    vi.stubGlobal("fetch", fetcher);
    const onSaved = vi.fn();
    await mount({ onSaved });
    expect(screen.getByText("Looking up")).toBeTruthy();
    expect(screen.getByText("SignalHire")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Enrich/ })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText("0 phones found")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enrich again" })).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cancel or restart queued work when the inline control closes", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(json(status([job]))));
    vi.stubGlobal("fetch", fetcher);
    const view = await mount();
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it("supports explicitly collecting more numbers and shows every returned mobile inline", async () => {
    const fetcher = vi.fn((_url, init) => Promise.resolve(init?.method === "POST"
      ? json({ queued: 1, alreadyRunning: 0, missingLinkedIn: 0 })
      : json(status())));
    vi.stubGlobal("fetch", fetcher);
    const view = await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Find more numbers" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enrich" })); });
    const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1].body).collectAll).toBe(true);
    view.unmount();
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    fetcher.mockImplementation(() => Promise.resolve(json(status([{ ...job, status: "complete", results: [{ number: "9158198424", provider: "signalhire" }, { number: "+14155550123", provider: "apollo" }] }]))));
    await mount();
    expect(screen.getByRole("button", { name: "Copy 9158198424" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy +14155550123" })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy +14155550123" })); });
    expect(clipboard.writeText).toHaveBeenCalledWith("+14155550123");
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  it("never retries a lost submission automatically and reconciles the persisted queue", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(status()))
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(json(status([job])));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enrich" })); });
    expect(screen.getByText("Connection lost")).toBeTruthy();
    expect(screen.getByText("Looking up")).toBeTruthy();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Enrich/ })).toBeNull();
  });

  it("blocks paid commands while status is unknown or a LinkedIn URL is missing", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ error: "Status unavailable" }, 503));
    vi.stubGlobal("fetch", fetcher);
    const view = await mount();
    expect((screen.getByRole("button", { name: "Enrich" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("0 phones found")).toBeNull();
    view.unmount();
    fetcher.mockImplementation(() => Promise.resolve(json(status())));
    await mount({ linkedin: undefined });
    expect((screen.getByRole("button", { name: "Enrich" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Add a LinkedIn URL first.")).toBeTruthy();
  });

  it("requires explicit review before retrying an uncertain provider request", async () => {
    const fetcher = vi.fn((_url, init) => Promise.resolve(init?.method === "POST" ? json({}) : json(status([{ ...job, status: "needs_review" }]))));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    expect((screen.getByRole("button", { name: "Retry request" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Request checked" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry request" })); });
    const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toEqual({ role: "role", action: "retry", job: "job" });
  });
});
