// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TableDialog } from "../src/components/recruiting/table-dialog";

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
});
afterEach(cleanup);

describe("workspace dialogs", () => {
  it("allows Escape to dismiss an idle dialog and prevents dismissal during a save", () => {
    const onClose = vi.fn();
    const content = <h2 id="dialog-title">Edit profile</h2>;
    const { rerender } = render(<TableDialog titleId="dialog-title" onClose={onClose}>{content}</TableDialog>);
    const dialog = screen.getByRole("dialog", { name: "Edit profile" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<TableDialog titleId="dialog-title" busy onClose={onClose}>{content}</TableDialog>);
    expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("keeps modal keyboard events from reaching the underlying sheet shortcuts", () => {
    const shortcut = vi.fn();
    render(<div onKeyDown={shortcut}><TableDialog titleId="dialog-title" onClose={() => {}}><h2 id="dialog-title">Edit profile</h2><input aria-label="Name" /></TableDialog></div>);
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Delete" });
    expect(shortcut).not.toHaveBeenCalled();
  });
});
