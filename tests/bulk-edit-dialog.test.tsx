// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BulkEditDialog } from "../src/components/recruiting/bulk-edit-dialog";
import { act } from "../src/lib/client/act";
vi.mock("../src/lib/client/act", () => ({ act: vi.fn() }));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype,"showModal",{ configurable: true, value() { this.setAttribute("open",""); } });
  Object.defineProperty(HTMLDialogElement.prototype,"close",{ configurable: true, value() { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const preview = { token: "a".repeat(32), rows: [{ id: "row-a", name: "Alex", before: null, after: "Call tomorrow" }], changed: 1, skipped: 1, shared: false, otherRoleMemberships: 0, batchId: null };
function setup() {
  const onSaved = vi.fn();
  render(<BulkEditDialog clientId="client" roleId="role" roleName="Test role" ids={["row-a","row-b"]} stage="all_profiles" fields={[]} onClose={() => {}} onSaved={onSaved}/>);
  return { onSaved };
}
describe("bulk edit review flow", () => {
  it("requires preview before applying and sends the selected scope and preview token", async () => {
    vi.mocked(act).mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...preview, batchId: "batch" });
    const { onSaved } = setup();
    expect(screen.queryByRole("button",{name:/Apply to/})).toBeNull();
    fireEvent.change(screen.getByLabelText("New value"),{target:{value:"Call tomorrow"}});
    fireEvent.click(screen.getByRole("button",{name:"Preview changes"}));
    await screen.findByRole("button",{name:"Apply to 1 row"});
    expect(act).toHaveBeenNthCalledWith(1,"bulkEditCandidates",expect.objectContaining({ids:["row-a","row-b"],field:"internal_notes",mode:"fill_empty",expected:null}));
    fireEvent.click(screen.getByRole("button",{name:"Apply to 1 row"}));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(act).toHaveBeenNthCalledWith(2,"bulkEditCandidates",expect.objectContaining({expected:preview.token}));
  });
  it("invalidates a preview when the operator changes its value or mode", async () => {
    vi.mocked(act).mockResolvedValueOnce(preview);
    setup();
    fireEvent.change(screen.getByLabelText("New value"),{target:{value:"Call tomorrow"}});
    fireEvent.click(screen.getByRole("button",{name:"Preview changes"}));
    await screen.findByRole("button",{name:"Apply to 1 row"});
    fireEvent.change(screen.getByLabelText("New value"),{target:{value:"Changed after preview"}});
    expect(screen.queryByRole("button",{name:/Apply to/})).toBeNull();
  });
  it("shows a stale preview error without reporting success", async () => {
    vi.mocked(act).mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error("Data changed since this preview."));
    const { onSaved } = setup();
    fireEvent.change(screen.getByLabelText("New value"),{target:{value:"Call tomorrow"}});
    fireEvent.click(screen.getByRole("button",{name:"Preview changes"}));
    fireEvent.click(await screen.findByRole("button",{name:"Apply to 1 row"}));
    expect((await screen.findByRole("alert")).textContent).toContain("Data changed");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole("button",{name:/Apply to/})).toBeNull();
  });
  it("makes shared profile scope explicit and previews clearing with a null value", async () => {
    vi.mocked(act).mockResolvedValueOnce({ ...preview, shared: true });
    setup();
    fireEvent.change(screen.getByLabelText("Field"),{target:{value:"current_company"}});
    expect(screen.getByText(/This edits shared profiles/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Edit mode"),{target:{value:"clear"}});
    expect(screen.queryByLabelText("New value")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Preview changes"}));
    await screen.findByRole("button",{name:"Apply to 1 row"});
    expect(act).toHaveBeenCalledWith("bulkEditCandidates",expect.objectContaining({field:"current_company",mode:"clear",value:null}));
  });
});
