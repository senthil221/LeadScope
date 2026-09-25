// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SheetCell } from "../src/components/recruiting/sheet-cell";

afterEach(cleanup);
function setup(props: Partial<Parameters<typeof SheetCell>[0]> = {}) {
  const save = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
  render(<div data-sheet-grid><SheetCell row={0} col={0} label="Name" value="Original" save={save} {...props}/>
    <SheetCell row={0} col={1} label="Company" value="Acme" save={async () => {}} />
    <button>Outside</button></div>);
  return { save, cell: screen.getByRole("gridcell", { name: "Name" }) };
}
describe("spreadsheet editing and persistence", () => {
  it("moves through the current and next row without leaving the grid", () => {
    render(<div data-sheet-grid>
      <SheetCell row={0} col={0} label="First name" value="A" save={async () => {}} />
      <SheetCell row={0} col={1} label="First company" value="B" save={async () => {}} />
      <SheetCell row={1} col={0} label="Second name" value="C" save={async () => {}} />
      <SheetCell row={1} col={1} label="Second company" value="D" save={async () => {}} />
    </div>);
    const first = screen.getByRole("gridcell", { name: "First name" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("gridcell", { name: "First company" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("gridcell", { name: "Second company" }));
  });
  it("opens with one click and saves once when focus leaves the editor", async () => {
    const { save, cell } = setup();
    fireEvent.click(cell);
    const editor = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(editor, { target: { value: "Changed" } });
    // A real focus transfer reproduces the native focusout / React blur ordering.
    screen.getByRole("button", { name: "Outside" }).focus();
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("Changed"));
    expect(cell.textContent).toContain("Changed");
    expect(document.activeElement?.textContent).toBe("Outside");
  });
  it.each(["Enter", "Tab"])("persists %s without reopening or submitting twice", async (key) => {
    const { save, cell } = setup();
    fireEvent.click(cell);
    const editor = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(editor, { target: { value: "Saved value" } });
    fireEvent.keyDown(editor, { key });
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("Saved value"));
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    if (key === "Tab") expect(document.activeElement).toBe(screen.getByRole("gridcell", { name: "Company" }));
  });
  it("changes a controlled dropdown and persists on blur", async () => {
    const { save, cell } = setup({ kind: "select", value: "Pending", options: ["Pending", "Ready"] });
    fireEvent.click(cell);
    const editor = screen.getByRole("combobox", { name: "Name" });
    fireEvent.change(editor, { target: { value: "Ready" } });
    screen.getByRole("button", { name: "Outside" }).focus();
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("Ready"));
  });
  it("cancels with Escape without saving", () => {
    const { save, cell } = setup();
    fireEvent.click(cell);
    const editor = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(editor, { target: { value: "Discard" } });
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(save).not.toHaveBeenCalled();
    expect(cell.textContent).toBe("Original");
  });
  it("restores the previous value and surfaces a rejected save", async () => {
    const save = vi.fn(async () => { throw new Error("Invalid value"); });
    const { cell } = setup({ save });
    fireEvent.click(cell);
    const editor = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(editor, { target: { value: "Bad value" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed"));
    expect(cell.textContent).toContain("Original");
    expect(cell.title).toBe("Invalid value");
  });
  it("keeps system metadata read-only", () => {
    const { save, cell } = setup({ readOnly: true });
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
