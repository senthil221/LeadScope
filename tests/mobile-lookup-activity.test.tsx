// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MobileLookupActivity } from "../src/components/recruiting/mobile-lookup-activity";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const cell = { candidate_id: "profile", status: "no_mobile", identifier: "https://www.linkedin.com/in/person", checked_at: "2026-10-03T12:12:39Z", phone_count: 0 };

describe("phone lookup state in the table", () => {
  it("loads an existing zero result without starting a new lookup or refetching on rerender", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ active: 0, review: 0, resultVersion: cell.checked_at, cells: [cell] })));
    vi.stubGlobal("fetch", fetcher);
    const onStates = vi.fn(), onUpdate = vi.fn(), onOpen = vi.fn();
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<MobileLookupActivity roleId="role" candidateIds={["profile"]} version={0} onStates={onStates} onUpdate={onUpdate} onOpen={onOpen} />); });
    expect(onStates).toHaveBeenCalledWith([cell]); expect(onUpdate).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0][1].method).toBeUndefined();
    await act(async () => { view!.rerender(<MobileLookupActivity roleId="role" candidateIds={["profile"]} version={0} onStates={onStates} onUpdate={onUpdate} onOpen={onOpen} />); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refreshes on a zero-phone completion and stops polling once finished", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: 1, review: 0, resultVersion: null, cells: [{ ...cell, status: "running" }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: 0, review: 0, resultVersion: cell.checked_at, cells: [cell] })));
    vi.stubGlobal("fetch", fetcher);
    const onStates = vi.fn(), onUpdate = vi.fn();
    await act(async () => { render(<MobileLookupActivity roleId="role" candidateIds={["profile"]} version={0} onStates={onStates} onUpdate={onUpdate} onOpen={() => {}} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(onStates).toHaveBeenLastCalledWith([cell]); expect(onUpdate).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
