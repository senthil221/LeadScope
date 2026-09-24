"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, FolderOpen, Search } from "lucide-react";
import type { ClientNavigationItem } from "@/lib/types";

// A native <select> hands its list to the operating system, which draws a
// square white box with a blue bar through it and ignores every token in this
// stylesheet. This is the same control drawn by the app instead: a button and
// a listbox, so the popup can look like the rest of the workspace and can show
// which client is archived and which one you are in.
//
// Everything a <select> gave away for free has to be put back by hand — the
// arrow keys, Home and End, typing a letter to jump, Escape, closing on a
// click elsewhere, and telling a screen reader which option is active — which
// is why it is worth doing once, here, rather than per dropdown.

type Option = { id: string; name: string; archived?: boolean };

// A handful of clients is a list you read. Past that it is a list you search.
const SEARCHABLE_FROM = 8;

export function ClientSwitcher({
  clients,
  currentId,
}: {
  clients: ClientNavigationItem[];
  currentId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  const options: Option[] = [
    { id: "", name: "All clients" },
    ...clients.map((client) => ({
      id: client.id,
      name: client.name,
      archived: client.archived,
    })),
  ];
  const searchable = clients.length >= SEARCHABLE_FROM;
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? options.filter((option) => option.name.toLocaleLowerCase().includes(needle))
    : options;
  const current = options.find((option) => option.id === (currentId ?? ""));

  function show() {
    setQuery("");
    setActive(Math.max(0, options.findIndex((option) => option.id === (currentId ?? ""))));
    setOpen(true);
  }
  function hide(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) root.current?.querySelector("button")?.focus();
  }
  function choose(option: Option) {
    hide();
    if (option.id !== (currentId ?? ""))
      router.push(option.id ? `/clients/${option.id}` : "/clients");
  }

  // Focus the field worth typing into, and keep the highlighted row in view
  // when the arrow keys walk past the edge of a scrolling list.
  useEffect(() => {
    if (open && searchable) search.current?.focus();
  }, [open, searchable]);
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node))
        setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function move(to: number) {
    if (!shown.length) return;
    setActive(Math.min(Math.max(to, 0), shown.length - 1));
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        hide();
        return;
      case "ArrowDown":
        event.preventDefault();
        return move(active + 1);
      case "ArrowUp":
        event.preventDefault();
        return move(active - 1);
      case "Home":
        event.preventDefault();
        return move(0);
      case "End":
        event.preventDefault();
        return move(shown.length - 1);
      case "Enter":
      case "Tab": {
        const option = shown[active];
        if (!option) return;
        event.preventDefault();
        return choose(option);
      }
      default:
        break;
    }
    // Type-ahead, the way a <select> does it: letters typed close together
    // build up a prefix, and a pause starts a new one.
    if (searchable || event.key.length !== 1 || event.metaKey || event.ctrlKey) return;
    // The event's own timestamp rather than a clock reading, which would be a
    // call out to the world from inside a render.
    const now = event.timeStamp;
    typed.current = {
      text: (now - typed.current.at < 900 ? typed.current.text : "") + event.key,
      at: now,
    };
    const prefix = typed.current.text.toLocaleLowerCase();
    const found = shown.findIndex((option) =>
      option.name.toLocaleLowerCase().startsWith(prefix),
    );
    if (found >= 0) setActive(found);
  }

  return (
    <div className="client-switcher" ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="client-switcher-trigger"
        aria-label="Switch client"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? hide(false) : show())}
      >
        <FolderOpen size={15} aria-hidden="true" />
        <span className="client-switcher-name">{current?.name ?? "All clients"}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="client-switcher-popover">
          {searchable && (
            <div className="client-switcher-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={search}
                type="text"
                value={query}
                aria-label="Find a client"
                placeholder="Find a client"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
              />
            </div>
          )}
          <ul
            className="client-switcher-list"
            id={listId}
            role="listbox"
            ref={list}
            aria-label="Clients"
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            tabIndex={searchable ? -1 : 0}
            // The popover was opened deliberately; without this the arrow keys
            // would scroll the page instead of walking the list.
            autoFocus={!searchable}
          >
            {shown.map((option, index) => {
              const selected = option.id === (currentId ?? "");
              return (
                <li key={option.id || "all"}>
                  <button
                    type="button"
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={selected}
                    data-active={index === active}
                    className={`client-switcher-option${option.id ? "" : " is-all"}`}
                    onPointerEnter={() => setActive(index)}
                    onClick={() => choose(option)}
                    tabIndex={-1}
                  >
                    <span className="client-switcher-option-name">
                      {/* The name gives way before the tag does: a truncated
                          client name is still recognisable, half the word
                          "Archived" is not. */}
                      <span>{option.name}</span>
                      {option.archived && <em>Archived</em>}
                    </span>
                    {selected && <Check size={14} aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
            {!shown.length && (
              <li className="client-switcher-empty">No client matches that.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
