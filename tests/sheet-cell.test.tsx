// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SheetCell, type SheetCellNode } from "../src/components/recruiting/sheet-cell";

afterEach(cleanup);
function setup(props: Partial<Parameters<typeof SheetCell>[0]> = {}) {
  const save = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
  render(<div data-sheet-grid><SheetCell row={0} col={0} label="Name" value="Original" save={save} {...props}/>
    <SheetCell row={0} col={1} label="Company" value="Acme" save={async () => {}} />
    <button>Outside</button></div>);
  return { save, cell: screen.getByRole("gridcell", { name: "Name" }) };
}
describe("spreadsheet editing and persistence", () => {
  it("shows the zero-result status without making it an editable phone value", async () => {
    const { save, cell } = setup({ value: "", emptyContent: <span>0 phones found</span>, emptyTitle: "All sources checked" });
    expect(cell.textContent).toBe("0 phones found"); expect(cell.title).toBe("All sources checked");
    fireEvent.click(cell);
    const editor = screen.getByRole("textbox", { name: "Name" });
    expect((editor as HTMLInputElement).value).toBe("");
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(cell);
    const phone = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(phone, { target: { value: "9876543210" } });
    fireEvent.keyDown(phone, { key: "Enter" });
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("9876543210", ""));
    expect(cell.textContent).toContain("9876543210"); expect(cell.textContent).not.toContain("0 phones found");
  });
  it("always displays an existing phone ahead of a zero-result indicator", () => {
    const { cell } = setup({ value: "9876543210", emptyContent: <span>0 phones found</span> });
    expect(cell.textContent).toBe("9876543210");
  });
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
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("Changed", "Original"));
    expect(cell.textContent).toContain("Changed");
    expect(document.activeElement?.textContent).toBe("Outside");
  });
  it.each(["Enter", "Tab"])("persists %s without reopening or submitting twice", async (key) => {
    const { save, cell } = setup();
    fireEvent.click(cell);
    const editor = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(editor, { target: { value: "Saved value" } });
    fireEvent.keyDown(editor, { key });
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("Saved value", "Original"));
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    if (key === "Tab") expect(document.activeElement).toBe(screen.getByRole("gridcell", { name: "Company" }));
  });
  it("changes a controlled dropdown and persists on blur", async () => {
    const { save, cell } = setup({ kind: "select", value: "Pending", options: ["Pending", "Ready"] });
    fireEvent.click(cell);
    const editor = screen.getByRole("combobox", { name: "Name" });
    fireEvent.change(editor, { target: { value: "Ready" } });
    screen.getByRole("button", { name: "Outside" }).focus();
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("Ready", "Pending"));
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
    fireEvent.click(cell);
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Bad value");
  });
  it("rejects the paste promise and keeps a failed pasted draft for correction", async () => {
    const save = vi.fn(async () => { throw new Error("Another operator changed this field"); });
    const { cell } = setup({ save });
    await act(async () => {
      await expect((cell as SheetCellNode).__sheetCommit!("Pasted value")).rejects.toThrow("Another operator");
    });
    expect(cell.textContent).toContain("Original");
    fireEvent.click(cell);
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Pasted value");
  });
  it("keeps system metadata read-only", () => {
    const { save, cell } = setup({ readOnly: true });
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
