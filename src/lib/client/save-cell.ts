"use client";
import { act } from "./act";
export function saveCell(kind: "profile" | "role", id: string, field: string, value: string, expected = "") {
  return act<{ moved?: boolean }>("saveCheckedCell", { kind, id, field, value, expected });
}
