// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "../src/lib/client/act";
import { RecruiterSelect } from "../src/components/recruiting/recruiter-select";

vi.mock("../src/lib/client/act", () => ({ act: vi.fn() }));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
});
afterEach(cleanup);

const list = [
  { id: "1", name: "Anshika", archived: false },
  { id: "2", name: "Rohan", archived: true },
  { id: "3", name: "Tisha", archived: false },
];
vi.mocked(act).mockImplementation(async (action: string) =>
  action === "recruiters" ? (list as never) : (undefined as never),
);

const options = () =>
  [...(screen.getByLabelText("Recruiter for Role") as HTMLSelectElement).options]
    .filter((option) => !option.disabled)
    .map((option) => option.textContent);

describe("the recruiter dropdown", () => {
  it("offers the kept names, an unassigned choice, and a way to edit the list", async () => {
    render(<RecruiterSelect label="Recruiter for Role" value="" onChoose={() => {}} />);
    await waitFor(() => expect(options()).toContain("Tisha"));
    expect(options()).toEqual(["Unassigned", "Anshika", "Tisha", "Edit names…"]);
  });

  // A role keeps who worked it, even after the name leaves the list.
  it("still shows a removed name on the role that has it", async () => {
    render(<RecruiterSelect label="Recruiter for Role" value="Rohan" onChoose={() => {}} />);
    await waitFor(() => expect(options()).toContain("Rohan (removed)"));
    expect((screen.getByLabelText("Recruiter for Role") as HTMLSelectElement).value).toBe("Rohan");
  });

  it("assigns in one choice", async () => {
    const onChoose = vi.fn();
    render(<RecruiterSelect label="Recruiter for Role" value="" onChoose={onChoose} />);
    await waitFor(() => expect(options()).toContain("Tisha"));
    fireEvent.change(screen.getByLabelText("Recruiter for Role"), { target: { value: "Tisha" } });
    expect(onChoose).toHaveBeenCalledWith("Tisha");
  });

  it("opens the list editor instead of assigning anybody called 'Edit names…'", async () => {
    const onChoose = vi.fn();
    render(<RecruiterSelect label="Recruiter for Role" value="Tisha" onChoose={onChoose} />);
    await waitFor(() => expect(options()).toContain("Tisha"));
    fireEvent.change(screen.getByLabelText("Recruiter for Role"), { target: { value: "__manage" } });
    expect(onChoose).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Recruiters" })).toBeTruthy();
    expect(screen.getByLabelText("New recruiter name")).toBeTruthy();
  });
});
