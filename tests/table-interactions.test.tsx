// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ColumnResizeHandle } from "../src/components/recruiting/table-layout";
import { DropdownDetails } from "../src/components/recruiting/dropdown-details";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("previews the displayed column width and commits only once on pointer release", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const save = vi.fn();
  render(<table style={{ width: 1000, minWidth: 1000 }}><colgroup><col style={{ width: 700 }} /></colgroup><thead><tr><th><ColumnResizeHandle label="LinkedIn" width={240} onResize={save} /></th></tr></thead></table>);
  const handle = screen.getByRole("button");
  const table = document.querySelector("table")!, heading = document.querySelector("th")!, col = document.querySelector("col")!;
  vi.spyOn(heading, "getBoundingClientRect").mockReturnValue({ width: 700 } as DOMRect);
  vi.spyOn(table, "getBoundingClientRect").mockReturnValue({ width: 1000 } as DOMRect);
  handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = vi.fn(() => true); handle.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { button: 0, clientX: 700 });
  fireEvent.pointerMove(handle, { clientX: 650 });
  fireEvent.pointerMove(handle, { clientX: 600 });
  expect(col.style.width).toBe("600px");
  expect(table.style.width).toBe("900px");
  expect(save).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle);
  expect(save).toHaveBeenCalledExactlyOnceWith(600);
  expect(col.style.width).toBe("700px");
});

it("respects readable minimum widths during keyboard resizing", () => {
  const save = vi.fn();
  render(<ColumnResizeHandle label="Status" width={176} minWidth={176} onResize={save} />);
  fireEvent.keyDown(screen.getByRole("button"), { key: "ArrowLeft" });
  expect(save).toHaveBeenLastCalledWith(176);
  fireEvent.keyDown(screen.getByRole("button"), { key: "ArrowRight" });
  expect(save).toHaveBeenLastCalledWith(192);
});

it("closes dropdowns on outside pointer events even when a cell stops bubbling", () => {
  render(<><DropdownDetails open><summary>Columns</summary><input aria-label="Inside" /></DropdownDetails><button onPointerDown={e => e.stopPropagation()}>Outside cell</button></>);
  const menu = document.querySelector("details")!;
  fireEvent.pointerDown(screen.getByLabelText("Inside"));
  expect(menu.open).toBe(true);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside cell" }));
  expect(menu.open).toBe(false);
});

it("closes on Escape and returns focus to the disclosure without leaving the page", () => {
  render(<DropdownDetails open><summary>Columns</summary><input aria-label="Inside" /></DropdownDetails>);
  const outsideEscape = vi.fn(); document.addEventListener("keydown", outsideEscape);
  fireEvent.keyDown(screen.getByLabelText("Inside"), { key: "Escape" });
  expect(document.querySelector("details")!.open).toBe(false);
  expect(document.activeElement).toBe(document.querySelector("summary"));
  expect(outsideEscape).not.toHaveBeenCalled();
  document.removeEventListener("keydown", outsideEscape);
});
