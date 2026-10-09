// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InlineMobileLookup } from "../src/components/recruiting/inline-mobile-lookup";
import type { MobileJob } from "../src/lib/recruiting/mobile-waterfall";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const props = { roleId: "role", candidateId: "profile", linkedin: "https://www.linkedin.com/in/person", currentValue: "", zeroShownInCell: false, onQueued: vi.fn(), onSaved: vi.fn() };
const job: MobileJob = { id: "job", candidate_id: "profile", candidate_name: "Person", status: "running", provider_index: 1, collect_all: false, results: [], steps: [{ provider: "database", outcome: "no_mobile", count: 0 }], error_code: null, created_at: "2026-10-03T12:00:00Z", updated_at: "2026-10-03T12:00:00Z" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const status = (jobs: MobileJob[] = []) => ({ jobs, workerOnline: true });
async function mount(overrides: Partial<typeof props> = {}) {
  let view: ReturnType<typeof render>;
  await act(async () => { view = render(<InlineMobileLookup {...props} {...overrides} />); });
  return view!;
}

describe("mobile enrichment inside a phone cell", () => {
  // Opening the cell is the request: one read of the history, then one queued lookup.
  it("reads history first, then queues the profile once without a second click", async () => {
    let release!: (value: Response) => void;
    const fetcher = vi.fn((_url, init) => init?.method === "POST"
      ? new Promise<Response>((resolve) => { release = resolve; })
      : Promise.resolve(json(status())));
    vi.stubGlobal("fetch", fetcher);
    const onQueued = vi.fn();
    await mount({ onQueued });
    await act(async () => {});
    expect(fetcher.mock.calls[0][0]).toContain("candidate=profile");
    expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Enrich" })).toBeNull();
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
      .mockResolvedValueOnce(json(status([{ ...job, provider_index: 2, steps: [...job.steps, { provider: "signalhire", outcome: "no_mobile", count: 0 }], updated_at: "2026-10-03T12:01:00Z" }])))
      .mockResolvedValueOnce(json(status([{ ...job, status: "no_mobile", provider_index: 4, updated_at: "2026-10-03T12:03:00Z" }])));
    vi.stubGlobal("fetch", fetcher);
    const onSaved = vi.fn();
    await mount({ onSaved });
    expect(screen.getByText("Checking SignalHire")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    expect(screen.queryByRole("button", { name: /^Enrich/ })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText("Checking Apollo")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2");
    expect(onSaved).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText("0 phones found")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enrich/ })).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetcher).toHaveBeenCalledTimes(3);
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

  it("gets all returned mobiles in one command without a second enrichment or duplicated cell value", async () => {
    const fetcher = vi.fn((_url, init) => Promise.resolve(init?.method === "POST"
      ? json({ queued: 1, alreadyRunning: 0, missingLinkedIn: 0 })
      : json(status())));
    vi.stubGlobal("fetch", fetcher);
    const view = await mount();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await act(async () => {});
    const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1].body).collectAll).toBe(false);
    view.unmount();
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    fetcher.mockImplementation(() => Promise.resolve(json(status([{ ...job, status: "complete", results: [{ number: "9158198424", provider: "signalhire" }, { number: "+14155550123", provider: "apollo" }] }]))));
    await mount({ currentValue: "9158198424" });
    expect(screen.getByText("2 mobiles")).toBeTruthy();
    expect(screen.queryByText("91581 98424")).toBeNull();
    expect(screen.queryByRole("button", { name: /Enrich/ })).toBeNull();
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
    await act(async () => {});
    expect(screen.getByText("Connection lost")).toBeTruthy();
    expect(screen.getByText("Checking SignalHire")).toBeTruthy();
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

  it("shows a paused source without offering another paid request in the cell", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(status([{ ...job, status: "needs_review" }])));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    expect(screen.getByText("Review SignalHire")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it("refreshes table values when a new lookup finishes before the first progress poll", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(status())).mockResolvedValueOnce(json({ queued: 1 }))
      .mockResolvedValueOnce(json(status([{ ...job, status: "complete", results: [{ number: "9158198424", provider: "database" }] }])));
    vi.stubGlobal("fetch", fetcher);
    const onSaved = vi.fn();
    await mount({ onSaved });
    await act(async () => {});
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Enrich/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy 9158198424" })).toBeTruthy();
  });
});
