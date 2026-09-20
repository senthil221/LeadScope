"use client";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type { CellKind } from "@/lib/recruiting/columns";

// Cells are addressed through the DOM rather than a registry: columns differ
// per tab and rows paginate, so a coordinate lookup that reads what is
// actually rendered stays correct without a second source of truth.
function sheetCells(from: HTMLElement) {
  const grid = from.closest<HTMLElement>("[data-sheet-grid]");
  if (!grid) return [];
  return Array.from(grid.querySelectorAll<HTMLElement>("[data-sheet-cell]"));
}

function coordinates(cell: HTMLElement) {
  return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
}

function moveFocus(from: HTMLElement, rowStep: number, colStep: number) {
  const cells = sheetCells(from);
  const { row, col } = coordinates(from);
  if (colStep !== 0) {
    const sameRow = cells
      .filter((cell) => coordinates(cell).row === row)
      .sort((a, b) => coordinates(a).col - coordinates(b).col);
    const index = sameRow.indexOf(from);
    const next = sameRow[index + colStep];
    if (next) {
      next.focus();
      return true;
    }
    // Falling off the end of a row continues on the next one, the way Tab
    // wraps in a spreadsheet.
    return moveFocus(from, colStep > 0 ? 1 : -1, 0);
  }
  const targetRow = row + rowStep;
  const candidates = cells.filter((cell) => coordinates(cell).row === targetRow);
  if (!candidates.length) return false;
  const exact = candidates.find((cell) => coordinates(cell).col === col);
  const nearest =
    exact ??
    candidates.reduce((best, cell) =>
      Math.abs(coordinates(cell).col - col) < Math.abs(coordinates(best).col - col)
        ? cell
        : best,
    );
  nearest.focus();
  return true;
}

export function SheetCell({
  row,
  col,
  value,
  kind = "text",
  options = [],
  readOnly = false,
  placeholder = "",
  label,
  display,
  save,
  onSaved,
}: {
  row: number;
  col: number;
  value: string;
  kind?: CellKind;
  options?: string[];
  readOnly?: boolean;
  placeholder?: string;
  label: string;
  display?: (value: string) => ReactNode;
  save: (value: string) => Promise<void>;
  onSaved?: (value: string) => void;
}) {
  const [current, setCurrent] = useState(value);
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);
  // The input mounts a render after the first keystroke, so keys typed in
  // between still arrive at the cell. A ref tracks the edit synchronously and
  // collects those characters instead of letting each one restart the edit.
  const editingRef = useRef(false);
  const pendingRef = useRef("");
  const selectOnEditRef = useRef(true);

  // A refresh after a save elsewhere (a stage move, an import) should win over
  // whatever this cell last rendered. Adjusting during render rather than in an
  // effect avoids the extra commit a cascading setState would cost per cell.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setCurrent(value);
  }

  useEffect(() => {
    if (!editing) return;
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    // Enter and double-click edit the existing value, so select it. Typing
    // over a cell has already replaced it, so leave the caret at the end.
    if (
      node instanceof HTMLInputElement &&
      node.type === "text" &&
      selectOnEditRef.current
    )
      node.select();
  }, [editing]);

  // Committing moves focus to the next cell while this one is still mounted,
  // so close the editor once focus has actually left rather than relying on
  // every exit path to tear it down itself.
  useEffect(() => {
    if (!editing) return;
    const node = rootRef.current;
    if (!node) return;
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && node.contains(next)) return;
      editingRef.current = false;
      setEditing(false);
    };
    node.addEventListener("focusout", onFocusOut);
    return () => node.removeEventListener("focusout", onFocusOut);
  }, [editing]);

  function beginEdit(initial?: string) {
    if (readOnly) return;
    editingRef.current = true;
    selectOnEditRef.current = initial === undefined;
    pendingRef.current = initial ?? current;
    setDraft(pendingRef.current);
    setError("");
    setEditing(true);
  }

  function cancel() {
    editingRef.current = false;
    setEditing(false);
    setDraft(current);
    rootRef.current?.focus();
  }

  // `move` runs instead of refocusing this cell. Losing focus to a click
  // elsewhere passes nothing, so the commit never drags focus back.
  async function commit(next: string, move?: (() => boolean) | null) {
    editingRef.current = false;
    setEditing(false);
    const restoreFocus = () => {
      if (move === undefined) rootRef.current?.focus();
      // A move that finds no neighbour (the last row, the last column) must
      // still land somewhere, or focus falls to the body and the grid stops
      // responding to the keyboard.
      else if (move && move() === false) rootRef.current?.focus();
    };
    if (next === current) {
      restoreFocus();
      return;
    }
    const previous = current;
    setCurrent(next);
    setStatus("saving");
    setError("");
    restoreFocus();
    try {
      await save(next);
      setStatus("idle");
      onSaved?.(next);
    } catch (e) {
      // A rejected save puts the recruiter back on the cell that failed, with
      // the old value restored, rather than leaving a half-open editor behind.
      editingRef.current = false;
      setEditing(false);
      setCurrent(previous);
      setDraft(previous);
      setStatus("error");
      setError((e as Error).message);
      rootRef.current?.focus();
    }
  }

  async function toggleBoolean() {
    if (readOnly) return;
    await commit(current === "true" ? "" : "true");
  }

  function onCellKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const node = rootRef.current;
    if (!node) return;
    // The editor lives inside this div, so its keydowns bubble here too. The
    // input has already handled them — re-reading Enter after it committed
    // would immediately reopen the editor on a cell that just saved.
    if (event.target !== event.currentTarget) return;
    // Keys that land here after an edit started belong to the input that is
    // about to take focus, not to grid navigation. Escape, Enter and Tab are
    // still answered here: if the input never takes focus, swallowing them
    // would leave the cell in an edit nothing can close.
    if (editingRef.current) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void commit(pendingRef.current, () => moveFocus(node, 1, 0));
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const shift = event.shiftKey;
        void commit(pendingRef.current, () =>
          moveFocus(node, 0, shift ? -1 : 1),
        );
        return;
      }
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        pendingRef.current += event.key;
        setDraft(pendingRef.current);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        pendingRef.current = pendingRef.current.slice(0, -1);
        setDraft(pendingRef.current);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveFocus(node, 1, 0);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(node, -1, 0);
        return;
      case "ArrowRight":
        event.preventDefault();
        moveFocus(node, 0, 1);
        return;
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(node, 0, -1);
        return;
      case "Tab":
        event.preventDefault();
        moveFocus(node, 0, event.shiftKey ? -1 : 1);
        return;
      case "Enter":
        event.preventDefault();
        if (kind === "boolean") void toggleBoolean();
        else beginEdit();
        return;
      case "Backspace":
      case "Delete":
        if (readOnly || kind === "boolean") return;
        event.preventDefault();
        void commit("");
        return;
      case " ":
        if (kind !== "boolean") return;
        event.preventDefault();
        void toggleBoolean();
        return;
      default:
        break;
    }
    // Typing over a selected cell replaces it, as it does in a spreadsheet.
    if (
      !readOnly &&
      kind !== "boolean" &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      beginEdit(kind === "select" ? current : event.key);
    }
  }

  function onInputKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    const node = rootRef.current;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void commit(event.currentTarget.value, () => !!node && moveFocus(node, 1, 0));
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const shift = event.shiftKey;
      void commit(
        event.currentTarget.value,
        () => !!node && moveFocus(node, 0, shift ? -1 : 1),
      );
    }
  }

  const className = [
    "sheet-cell",
    readOnly ? "is-readonly" : "is-editable",
    editing ? "is-editing" : "",
    status === "saving" ? "is-saving" : "",
    status === "error" ? "is-error" : "",
    current ? "" : "is-empty",
  ]
    .filter(Boolean)
    .join(" ");

  if (kind === "boolean") {
    return (
      <div
        aria-label={label}
        className={className}
        data-col={col}
        data-row={row}
        data-sheet-cell=""
        onKeyDown={onCellKeyDown}
        ref={rootRef}
        role="gridcell"
        tabIndex={0}
        title={error || undefined}
      >
        <input
          aria-hidden="true"
          checked={current === "true"}
          disabled={readOnly}
          onChange={() => void toggleBoolean()}
          tabIndex={-1}
          type="checkbox"
        />
      </div>
    );
  }

  return (
    <div
      aria-label={label}
      className={className}
      data-col={col}
      data-row={row}
      data-sheet-cell=""
      onDoubleClick={() => beginEdit()}
      onFocus={(event) => {
        // Focus landing on the cell itself while an edit is open means the
        // input never took it. Close the edit rather than leave a cell whose
        // editor cannot be reached or dismissed.
        if (event.target !== rootRef.current || !editingRef.current) return;
        editingRef.current = false;
        setEditing(false);
        setDraft(current);
      }}
      onKeyDown={onCellKeyDown}
      ref={rootRef}
      role="gridcell"
      tabIndex={editing ? -1 : 0}
      title={error || undefined}
    >
      {editing ? (
        kind === "select" ? (
          <select
            className="sheet-input"
            onBlur={(event) => {
              if (editingRef.current) void commit(event.currentTarget.value, null);
            }}
            onKeyDown={onInputKeyDown}
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            value={draft}
          >
            <option value="">—</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="sheet-input"
            inputMode={kind === "number" ? "decimal" : undefined}
            onBlur={(event) => {
              if (editingRef.current) void commit(event.currentTarget.value, null);
            }}
            onChange={(event) => {
              pendingRef.current = event.currentTarget.value;
              setDraft(pendingRef.current);
            }}
            onKeyDown={onInputKeyDown}
            ref={inputRef as React.RefObject<HTMLInputElement>}
            step={kind === "number" ? "0.1" : undefined}
            type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
            value={draft}
          />
        )
      ) : (
        <span className="sheet-value">
          {current ? (display ? display(current) : current) : (
            <span className="sheet-placeholder">{placeholder}</span>
          )}
        </span>
      )}
      {status === "error" && <span aria-hidden="true" className="sheet-flag" />}
    </div>
  );
}
