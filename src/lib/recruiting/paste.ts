// Google Sheets and Excel both put the selection on the clipboard as
// tab-separated rows, so a pasted block is parsed the same way for both.
export const PASTE_MAX_ROWS = 200;
export const PASTE_MAX_COLUMNS = 40;

export function parsePastedBlock(
  text: string,
  maxRows = PASTE_MAX_ROWS,
  maxColumns = PASTE_MAX_COLUMNS,
): string[][] {
  if (!text) return [];
  return text
    .replace(/\r\n?/g, "\n")
    // One trailing newline is how a spreadsheet terminates the last row, not
    // an extra empty row to paste.
    .replace(/\n$/, "")
    .split("\n")
    .slice(0, maxRows)
    .map((line) =>
      line
        .split("\t")
        .slice(0, maxColumns)
        .map((value) => value.trim()),
    );
}

// A single value is an ordinary paste and belongs to whatever editor is open,
// so the grid leaves it alone.
export function isSingleValue(block: string[][]) {
  return block.length === 1 && block[0].length === 1;
}
