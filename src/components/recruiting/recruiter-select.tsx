"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Pencil, UserRound, X } from "lucide-react";
import { act } from "@/lib/client/act";
import { TableDialog } from "./table-dialog";

export type Recruiter = { id: string; name: string; archived: boolean };

// One copy of the list for the whole page. Every dropdown reads it, so
// adding a name from any of them shows up in all of them at once, and a table
// of roles asks the server for it once rather than once a row.
const store = {
  list: null as Recruiter[] | null,
  listeners: new Set<() => void>(),
  loading: null as Promise<void> | null,
};
function emit() {
  store.listeners.forEach((listener) => listener());
}
export async function reloadRecruiters() {
  store.list = await act<Recruiter[]>("recruiters");
  emit();
}
function subscribe(listener: () => void) {
  store.listeners.add(listener);
  if (!store.list && !store.loading)
    store.loading = reloadRecruiters()
      .catch(() => {
        // Leave the list empty; each dropdown still shows its current value.
      })
      .finally(() => {
        store.loading = null;
      });
  return () => store.listeners.delete(listener);
}
export function useRecruiters() {
  return useSyncExternalStore(
    subscribe,
    () => store.list,
    () => null,
  );
}

// A soft colour per person, the same every time their name appears, so a
// column of assignments can be read at a glance.
const tints = [
  ["#e0ecff", "#1d4ed8"],
  ["#fde8e1", "#b4441b"],
  ["#e3f4ea", "#1f7a45"],
  ["#f1e6fb", "#7a3db8"],
  ["#fff3d6", "#94620a"],
  ["#e2f4f7", "#0f6e7c"],
] as const;
function RecruiterAvatar({ name }: { name: string }) {
  let hash = 0;
  for (const letter of name.toLowerCase()) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  const [background, color] = tints[hash % tints.length];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return (
    <span className="recruiter-avatar" style={{ background, color }} aria-hidden="true">
      {initials}
    </span>
  );
}

type Item =
  | { kind: "none" }
  | { kind: "name"; name: string; removed?: boolean }
  | { kind: "manage" };
type Place = { left: number; width: number; top?: number; bottom?: number };

// The dropdown itself, drawn by the app rather than handed to the operating
// system - a native select opens as a square white box with a blue bar and a
// row of dashes for a divider, and ignores everything this stylesheet says.
// It shows the current choice even before the list has arrived, and even if
// that person has since been removed from the list: a role keeps who worked it.
//
// The popover is placed against the page, not inside the table, so a cell at
// the edge of a scrolling table does not clip it or make the table scroll.
// Focus stays on the button throughout; the arrow keys move a highlight,
// Enter chooses, Escape closes, and a letter jumps to the name it starts.
export function RecruiterSelect({
  value,
  onChoose,
  disabled = false,
  label,
  className = "",
}: {
  value: string;
  onChoose: (name: string) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const list = useRecruiters();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [managing, setManaging] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  const active = (list ?? []).filter((recruiter) => !recruiter.archived);
  const offered = active.some((recruiter) => recruiter.name === value);
  const items: Item[] = [
    { kind: "none" },
    ...active.map((recruiter): Item => ({ kind: "name", name: recruiter.name })),
    ...(value && !offered ? [{ kind: "name", name: value, removed: Boolean(list) } as Item] : []),
    { kind: "manage" },
  ];
  const manageIndex = items.length - 1;
  const selectedIndex = value
    ? items.findIndex((item) => item.kind === "name" && item.name === value)
    : 0;

  function show() {
    const button = trigger.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.max(rect.width, 216);
    const height = Math.min(340, 56 + items.length * 34);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    // Opens upwards when the row is too near the bottom of the window.
    const up = rect.bottom + height + 12 > window.innerHeight && rect.top > height + 12;
    setPlace(
      up
        ? { left, width, bottom: window.innerHeight - rect.top + 6 }
        : { left, width, top: rect.bottom + 6 },
    );
    setActiveIndex(Math.max(0, selectedIndex));
    setOpen(true);
  }
  function hide(refocus = true) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }
  function pick(item: Item) {
    hide();
    if (item.kind === "manage") {
      setManaging(true);
      return;
    }
    const next = item.kind === "none" ? "" : item.name;
    if (next !== value) onChoose(next);
  }

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || popover.current?.contains(target)) return;
      setOpen(false);
    }
    // Placed against the page, so it closes rather than floating away from its
    // row when the table or the page scrolls underneath it.
    function onScroll(event: Event) {
      if (popover.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onResize() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        show();
      }
      return;
    }
    const last = items.length - 1;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return hide();
      case "Tab":
        return hide(false);
      case "ArrowDown":
        event.preventDefault();
        return setActiveIndex((index) => Math.min(index + 1, last));
      case "ArrowUp":
        event.preventDefault();
        return setActiveIndex((index) => Math.max(index - 1, 0));
      case "Home":
        event.preventDefault();
        return setActiveIndex(0);
      case "End":
        event.preventDefault();
        return setActiveIndex(last);
      case "Enter":
      case " ":
        event.preventDefault();
        return pick(items[activeIndex] ?? items[0]);
      default:
        break;
    }
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    // The event's own timestamp rather than a clock read inside a render.
    const now = event.timeStamp;
    typed.current = {
      text: (now - typed.current.at < 900 ? typed.current.text : "") + event.key,
      at: now,
    };
    const prefix = typed.current.text.toLowerCase();
    const found = items.findIndex(
      (item) => item.kind === "name" && item.name.toLowerCase().startsWith(prefix),
    );
    if (found >= 0) setActiveIndex(found);
  }

  const optionProps = (index: number) => ({
    id: `${listId}-${index}`,
    "data-active": index === activeIndex,
    onPointerEnter: () => setActiveIndex(index),
    // Keeps focus on the button, so the keyboard and the pointer agree.
    onPointerDown: (event: React.PointerEvent) => event.preventDefault(),
  });

  return (
    <>
      <button
        ref={trigger}
        type="button"
        // The select-only combobox pattern: the button keeps focus and names
        // the highlighted option, which is what lets a screen reader follow
        // the arrow keys through a list that never takes focus itself.
        role="combobox"
        className={`recruiter-picker${value ? "" : " is-empty"} ${className}`.trim()}
        aria-label={`${label}: ${value || "Unassigned"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? hide(false) : show())}
        onKeyDown={onKeyDown}
      >
        {value ? (
          <RecruiterAvatar name={value} />
        ) : (
          <span className="recruiter-avatar is-empty" aria-hidden="true">
            <UserRound size={12} />
          </span>
        )}
        <span className="recruiter-picker-name">{value || "Unassigned"}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={popover}
            className={`recruiter-popover${place.bottom !== undefined ? " is-up" : ""}`}
            style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom }}
          >
            <ul id={listId} role="listbox" aria-label={label} className="recruiter-popover-list">
              {items.map((item, index) => {
                if (item.kind === "manage") return null;
                const selected = index === selectedIndex;
                return (
                  <li
                    key={item.kind === "none" ? "" : item.name}
                    role="option"
                    aria-selected={selected}
                    className={`recruiter-option${item.kind === "none" ? " is-none" : ""}`}
                    onClick={() => pick(item)}
                    {...optionProps(index)}
                  >
                    {item.kind === "none" ? (
                      <span className="recruiter-avatar is-empty" aria-hidden="true">
                        <UserRound size={12} />
                      </span>
                    ) : (
                      <RecruiterAvatar name={item.name} />
                    )}
                    <span className="recruiter-option-name">
                      {item.kind === "none" ? "Unassigned" : item.name}
                    </span>
                    {item.kind === "name" && item.removed && <em>Removed</em>}
                    {selected && <Check size={14} aria-hidden="true" />}
                  </li>
                );
              })}
              {!list && <li className="recruiter-option is-loading">Loading names…</li>}
            </ul>
            <div className="recruiter-popover-footer">
              <button
                type="button"
                className="recruiter-option is-manage"
                onClick={() => pick({ kind: "manage" })}
                {...optionProps(manageIndex)}
              >
                <Pencil size={13} aria-hidden="true" />
                Edit names…
              </button>
            </div>
          </div>,
          document.body,
        )}
      {/* Out of whatever the dropdown sits in - a label inside the role form,
          a table cell - so the dialog is not nested in either. */}
      {managing &&
        createPortal(
          <ManageRecruitersDialog onClose={() => setManaging(false)} />,
          document.body,
        )}
    </>
  );
}

// Adding and removing names. Removing only stops a name being offered; the
// roles already assigned to that person keep it.
export function ManageRecruitersDialog({ onClose }: { onClose: () => void }) {
  const list = useRecruiters();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await reloadRecruiters();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function add() {
    const next = name.trim();
    if (!next || busy) return;
    void run(async () => {
      await act("saveRecruiter", { name: next });
      setName("");
    });
  }
  const active = (list ?? []).filter((recruiter) => !recruiter.archived);
  return (
    <TableDialog titleId="recruiters-title" busy={busy} onClose={onClose} className="recruiters-dialog">
      <div className="modal-heading">
        <h2 id="recruiters-title">Recruiters</h2>
        <button type="button" aria-label="Close" disabled={busy} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        The names offered in every role&rsquo;s recruiter dropdown. Removing a
        name stops it being offered; roles already assigned keep it.
      </p>
      <ul className="recruiters-list">
        {active.map((recruiter) => (
          <li key={recruiter.id}>
            <span>{recruiter.name}</span>
            <button
              type="button"
              className="small"
              disabled={busy}
              onClick={() => void run(() => act("archiveRecruiter", { id: recruiter.id }))}
            >
              Remove
            </button>
          </li>
        ))}
        {list && !active.length && <li className="muted">No names yet.</li>}
        {!list && <li className="muted">Loading…</li>}
      </ul>
      {/* Not a form: this dialog can open from inside the role form, and a
          submit here must never become a submit there. */}
      <div className="recruiters-add">
        <input
          data-dialog-autofocus
          aria-label="New recruiter name"
          placeholder="Add a name"
          maxLength={120}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <button className="primary" type="button" disabled={busy || !name.trim()} onClick={add}>
          Add
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </TableDialog>
  );
}
