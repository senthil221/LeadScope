// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DuplicateReview } from "../src/components/recruiting/duplicate-review";
import { act } from "../src/lib/client/act";
vi.mock("../src/lib/client/act", () => ({ act: vi.fn() }));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype,"showModal",{ configurable: true, value() { this.setAttribute("open",""); } });
  Object.defineProperty(HTMLDialogElement.prototype,"close",{ configurable: true, value() { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const profile = { name: "Alex", email: "team@example.com", phone: null, company: "Acme", designation: "Director", location: "", linkedin: null, roles: [] };
const pair = { first: { ...profile,id: "first" }, second: { ...profile,id: "second",name: "Taylor" }, reasons: ["Same email"], fingerprint: "a".repeat(32), revision: 0, status: "pending", note: "", reviewedAt: null, cursor: "pair" };
describe("duplicate review decisions", () => {
  it("shows matching profiles and records a keep-separate decision with its concurrency revision", async () => {
    vi.mocked(act).mockResolvedValueOnce({rows:[pair],nextCursor:null}).mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({rows:[],nextCursor:null});
    render(<DuplicateReview clientId="client" roleId="role" onClose={() => {}} />);
    await screen.findByText("Same email");
    expect(screen.getByRole("heading",{name:"Alex"})).toBeTruthy();
    expect(screen.getByRole("heading",{name:"Taylor"})).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Review note"),{target:{value:"Shared team mailbox; different people"}});
    fireEvent.click(screen.getByRole("button",{name:"Keep separate"}));
    await waitFor(() => expect(act).toHaveBeenCalledWith("reviewDuplicate",expect.objectContaining({firstId:"first",secondId:"second",status:"separate",revision:0,fingerprint:pair.fingerprint,note:"Shared team mailbox; different people"})));
    expect(await screen.findByText("No matching pairs in this review view.")).toBeTruthy();
  });
  it("surfaces stale-review failures without hiding the pair", async () => {
    vi.mocked(act).mockResolvedValueOnce({rows:[pair],nextCursor:null}).mockRejectedValueOnce(new Error("Another operator reviewed this pair. Reload the review."));
    render(<DuplicateReview clientId="client" roleId="role" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button",{name:"Confirm duplicate"}));
    expect((await screen.findByRole("alert")).textContent).toContain("Another operator");
    expect(screen.getByRole("heading",{name:"Alex"})).toBeTruthy();
  });
});
