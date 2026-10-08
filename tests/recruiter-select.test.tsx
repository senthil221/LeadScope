// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
beforeEach(() => {
  vi.mocked(act).mockImplementation(async (action: string) =>
    action === "recruiters" ? (list as never) : (undefined as never),
  );
});

const trigger = () => screen.getByRole("combobox");
async function openList() {
  fireEvent.click(trigger());
  const listbox = await screen.findByRole("listbox");
  await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));
  return listbox;
}
// The name as written, without the initial in its badge.
const optionNames = () =>
  screen
    .getAllByRole("option")
    .map((option) => option.querySelector(".recruiter-option-name")?.textContent);

describe("the recruiter dropdown", () => {
  it("names the current choice on the button, and Unassigned when there is none", () => {
    render(<RecruiterSelect label="Recruiter for Role" value="Tisha" onChoose={() => {}} />);
    expect(trigger().getAttribute("aria-label")).toBe("Recruiter for Role: Tisha");
    cleanup();
    render(<RecruiterSelect label="Recruiter for Role" value="" onChoose={() => {}} />);
    expect(trigger().textContent).toContain("Unassigned");
  });

  it("offers the kept names and an unassigned choice, with editing set apart", async () => {
    render(<RecruiterSelect label="Recruiter for Role" value="Tisha" onChoose={() => {}} />);
    await openList();
    await waitFor(() => expect(optionNames()).toEqual(["Unassigned", "Anshika", "Tisha"]));
    expect(screen.getByRole("option", { name: /Tisha/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: /Edit names/ })).toBeTruthy();
  });

  // A role keeps who worked it, even after the name leaves the list.
  it("still shows a removed name on the role that has it", async () => {
    render(<RecruiterSelect label="Recruiter for Role" value="Rohan" onChoose={() => {}} />);
    await openList();
    await waitFor(() => expect(optionNames()).toContain("Rohan"));
    const rohan = screen.getAllByRole("option").find((option) => option.textContent?.includes("Rohan"))!;
    expect(rohan.querySelector("em")?.textContent).toBe("Removed");
    expect(rohan.getAttribute("aria-selected")).toBe("true");
  });

  it("assigns with one click and closes", async () => {
    const onChoose = vi.fn();
    render(<RecruiterSelect label="Recruiter for Role" value="" onChoose={onChoose} />);
    await openList();
    fireEvent.click(await screen.findByRole("option", { name: /Anshika/ }));
    expect(onChoose).toHaveBeenCalledWith("Anshika");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("works from the keyboard: arrows to move, Enter to choose, Escape to leave", async () => {
    const onChoose = vi.fn();
    render(<RecruiterSelect label="Recruiter for Role" value="" onChoose={onChoose} />);
    await openList();
    fireEvent.keyDown(trigger(), { key: "Escape" });
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    await screen.findByRole("listbox");
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith("Anshika");
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    await screen.findByRole("listbox");
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("opens the list editor without assigning anybody", async () => {
    const onChoose = vi.fn();
    render(<RecruiterSelect label="Recruiter for Role" value="Tisha" onChoose={onChoose} />);
    await openList();
    fireEvent.click(screen.getByRole("button", { name: /Edit names/ }));
    expect(onChoose).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Recruiters" })).toBeTruthy();
    expect(screen.getByLabelText("New recruiter name")).toBeTruthy();
  });
});
