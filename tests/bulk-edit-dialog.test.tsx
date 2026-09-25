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
const preview = { token: "a".repeat(32), rows: [{ id: "row-a", name: "Alex", before: "csv", after: "google" }], changed: 1, skipped: 1, shared: false, otherRoleMemberships: 0, batchId: null };
function setup() {
  const onSaved = vi.fn();
  render(<BulkEditDialog clientId="client" roleId="role" roleName="Test role" ids={["row-a","row-b"]} stage="all_profiles" fields={[]} onClose={() => {}} onSaved={onSaved}/>);
  return { onSaved };
}
const choose = (value: string) =>
  fireEvent.change(screen.getByLabelText("New value"),{target:{value}});

describe("bulk edit review flow", () => {
  it("requires preview before applying and sends the selected scope and preview token", async () => {
    vi.mocked(act).mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...preview, batchId: "batch" });
    const { onSaved } = setup();
    expect(screen.queryByRole("button",{name:/Apply to/})).toBeNull();
    choose("google");
    fireEvent.click(screen.getByRole("button",{name:"Preview changes"}));
    await screen.findByRole("button",{name:"Apply to 1 row"});
    expect(act).toHaveBeenNthCalledWith(1,"bulkEditCandidates",expect.objectContaining({ids:["row-a","row-b"],field:"source",value:"google",mode:"replace",expected:null}));
    fireEvent.click(screen.getByRole("button",{name:"Apply to 1 row"}));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(act).toHaveBeenNthCalledWith(2,"bulkEditCandidates",expect.objectContaining({expected:preview.token}));
  });
  it("invalidates a preview when the operator changes its value", async () => {
    vi.mocked(act).mockResolvedValueOnce(preview);
    setup();
    choose("google");
    fireEvent.click(screen.getByRole("button",{name:"Preview changes"}));
    await screen.findByRole("button",{name:"Apply to 1 row"});
    choose("naukri");
    expect(screen.queryByRole("button",{name:/Apply to/})).toBeNull();
  });
  it("shows a stale preview error without reporting success", async () => {
    vi.mocked(act).mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error("Data changed since this preview."));
    const { onSaved } = setup();
    choose("google");
    fireEvent.click(screen.getByRole("button",{name:"Preview changes"}));
    fireEvent.click(await screen.findByRole("button",{name:"Apply to 1 row"}));
    expect((await screen.findByRole("alert")).textContent).toContain("Data changed");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole("button",{name:/Apply to/})).toBeNull();
  });
  // Source is the only field offered for now, and a row always has one.
  it("offers the six sources by name, with no field picker and no way to empty them", () => {
    setup();
    expect(screen.queryByLabelText("Field")).toBeNull();
    expect(screen.queryByLabelText("Edit mode")).toBeNull();
    const values = [...screen.getByLabelText("New value").querySelectorAll("option")];
    expect(values.map((option) => option.getAttribute("value"))).toEqual([
      "", "linkedin", "naukri", "google", "csv", "master_db", "other",
    ]);
    expect(values.map((option) => option.textContent)).toEqual([
      "Choose a value", "LinkedIn Recruiter", "Naukri", "Google Search",
      "CSV Import", "Master Database", "Other Source",
    ]);
    expect(screen.getByText(/move to Profile shortlisted/)).toBeTruthy();
  });
  it("reads a preview's before and after as source names rather than stored values", async () => {
    vi.mocked(act).mockResolvedValueOnce(preview);
    setup();
    choose("google");
    fireEvent.click(screen.getByRole("button",{name:"Preview changes"}));
    await screen.findByRole("button",{name:"Apply to 1 row"});
    const cells = [...screen.getByRole("table").querySelectorAll("tbody td")];
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Alex", "CSV Import", "Google Search",
    ]);
  });
});
