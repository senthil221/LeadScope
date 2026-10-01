// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PushProfilesDialog } from "../src/components/recruiting/push-profiles-dialog";
import { act } from "../src/lib/client/act";
vi.mock("../src/lib/client/act", () => ({ act: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const targets = [{ id: "target", name: "Engineer", clientName: "Client B" }];
describe("push profiles", () => {
  it("sends the selected source-role memberships and strict rating threshold", async () => {
    vi.mocked(act).mockResolvedValueOnce(targets).mockResolvedValueOnce({ added: 1, alreadyInRole: 0, matched: 1 });
    const onPushed = vi.fn();
    render(<PushProfilesDialog sourceRoleId="source" membershipIds={["membership"]} onClose={() => {}} onPushed={onPushed} />);
    await screen.findByRole("option", { name: "Client B / Engineer" });
    fireEvent.change(screen.getByLabelText("Target role"), { target: { value: "target" } });
    fireEvent.change(screen.getByLabelText("Above rating"), { target: { value: "4.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Push profiles" }));
    await waitFor(() => expect(onPushed).toHaveBeenCalledWith({ added: 1, alreadyInRole: 0, matched: 1 }, "target"));
    expect(act).toHaveBeenLastCalledWith("pushProfiles", expect.objectContaining({ sourceRoleId: "source", membershipIds: ["membership"], aboveRating: 4.5 }));
  });
  it("pushes Master Database selections without a global rating filter and reports errors", async () => {
    vi.mocked(act).mockResolvedValueOnce(targets).mockRejectedValueOnce(new Error("Choose an open target role."));
    const onPushed = vi.fn();
    render(<PushProfilesDialog candidateIds={["candidate"]} onClose={() => {}} onPushed={onPushed} />);
    await screen.findByRole("option", { name: "Client B / Engineer" });
    expect(screen.queryByLabelText("Above rating")).toBeNull();
    fireEvent.change(screen.getByLabelText("Target role"), { target: { value: "target" } });
    fireEvent.click(screen.getByRole("button", { name: "Push profiles" }));
    expect((await screen.findByRole("alert")).textContent).toContain("open target role");
    expect(onPushed).not.toHaveBeenCalled();
    expect(act).toHaveBeenLastCalledWith("pushProfiles", expect.objectContaining({ candidateIds: ["candidate"], aboveRating: null }));
  });
});
