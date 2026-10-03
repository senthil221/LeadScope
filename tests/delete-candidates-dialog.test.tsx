// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeleteCandidatesDialog } from "../src/components/recruiting/delete-candidates-dialog";

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
});
afterEach(cleanup);

describe("recoverable role deletion confirmation", () => {
  it("requires the exact typed confirmation, including on form submission", () => {
    const onConfirm = vi.fn();
    render(<DeleteCandidatesDialog count={2} roleName="Sales lead" busy={false} error="" onClose={() => {}} onConfirm={onConfirm} />);
    const input = screen.getByRole("textbox", { name: "Delete confirmation" });
    const button = screen.getByRole("button", { name: "Delete from role" }) as HTMLButtonElement;
    for (const value of ["", "delete", "DELETE ", "DELET"]) {
      fireEvent.change(input, { target: { value } });
      expect(button.disabled).toBe(true);
      fireEvent.submit(input.closest("form")!);
    }
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "DELETE" } });
    expect(button.disabled).toBe(false);
    fireEvent.submit(input.closest("form")!);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("DELETE");
  });
  it("blocks a second submission and dismissal while deletion is pending", () => {
    const onConfirm = vi.fn(), onClose = vi.fn();
    const props = { count: 1, roleName: "Sales lead", busy: false, error: "", onClose, onConfirm };
    const { rerender } = render(<DeleteCandidatesDialog {...props} />);
    const input = screen.getByRole("textbox", { name: "Delete confirmation" });
    fireEvent.change(input, { target: { value: "DELETE" } });
    rerender(<DeleteCandidatesDialog {...props} busy />);
    fireEvent.submit(input.closest("form")!);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).disabled).toBe(true);
  });
  it("cancels without requesting a deletion and starts each batch unconfirmed", () => {
    const onConfirm = vi.fn(), onClose = vi.fn();
    const props = { count: 1, roleName: "Sales lead", busy: false, error: "", onClose, onConfirm };
    const first = render(<DeleteCandidatesDialog {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Delete confirmation" }), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    first.unmount();
    render(<DeleteCandidatesDialog {...props} count={3} />);
    expect((screen.getByRole("textbox", { name: "Delete confirmation" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Delete from role" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
