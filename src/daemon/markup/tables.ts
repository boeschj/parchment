// Compiles a <table> to the right catalog component. A "regular" table — a
// single header row of <th> and body rows of matching width, no colspan/rowspan
// — becomes a DataTable (sortable, typed columns, CSV export). Anything
// irregular falls back to the shadcn Table, which takes ragged string rows
// verbatim. Numeric columns are detected so DataTable sorts them as numbers and
// right-aligns them.

import {
  collapsedTextOf,
  elementChildren,
  tagNameOf,
  type Element,
} from "./dom.ts";

export type CompiledTable = {
  type: "DataTable" | "Table";
  props: Record<string, unknown>;
};

export function compileTableElement(element: Element): CompiledTable {
  const rows = descendantRows(element);
  const headerRow = rows.find((row) => rowCells(row).some((cell) => tagNameOf(cell) === "th")) ?? null;
  const bodyRows = rows.filter((row) => row !== headerRow && rowCells(row).length > 0);
  const headers = headerRow ? rowCells(headerRow).map(collapsedTextOf) : [];
  const caption = captionOf(element);

  if (isRegular(headers, bodyRows)) {
    return compileDataTable(headers, bodyRows, caption);
  }
  return compileFallbackTable(headers, bodyRows, caption);
}

function descendantRows(element: Element): Element[] {
  const rows: Element[] = [];
  const visit = (node: Element): void => {
    for (const child of elementChildren(node)) {
      if (tagNameOf(child) === "tr") {
        rows.push(child);
        continue;
      }
      visit(child);
    }
  };
  visit(element);
  return rows;
}

function rowCells(row: Element): Element[] {
  return elementChildren(row).filter((cell) => {
    const tag = tagNameOf(cell);
    return tag === "td" || tag === "th";
  });
}

function captionOf(element: Element): string | null {
  const captionElement = elementChildren(element).find((child) => tagNameOf(child) === "caption");
  if (captionElement) return collapsedTextOf(captionElement);
  const attrCaption = element.attribs.caption ?? element.attribs.title;
  return attrCaption?.trim() ? attrCaption.trim() : null;
}

function isRegular(headers: string[], bodyRows: Element[]): boolean {
  if (headers.length === 0 || bodyRows.length === 0) return false;
  const everyRowMatchesWidth = bodyRows.every((row) => rowCells(row).length === headers.length);
  if (!everyRowMatchesWidth) return false;
  return !bodyRows.some(hasSpannedCell) && headers.length > 0;
}

function hasSpannedCell(row: Element): boolean {
  return rowCells(row).some(
    (cell) => cell.attribs.colspan !== undefined || cell.attribs.rowspan !== undefined,
  );
}

// ---- DataTable --------------------------------------------------------------

const NUMERIC_CELL_PATTERN = /^-?\d+(\.\d+)?$/;

function compileDataTable(headers: string[], bodyRows: Element[], caption: string | null): CompiledTable {
  const columnKeys = uniqueColumnKeys(headers);
  const columnTexts = bodyRows.map((row) => rowCells(row).map(collapsedTextOf));
  const numericByColumn = headers.map((_, index) => isNumericColumn(columnTexts, index));

  const columns = headers.map((header, index) => {
    const numeric = numericByColumn[index] === true;
    const key = columnKeys[index] ?? `col_${index + 1}`;
    if (numeric) return { key, header, type: "number", align: "right" };
    return { key, header };
  });

  const rows = columnTexts.map((cells) => {
    const record: Record<string, unknown> = {};
    cells.forEach((text, index) => {
      const key = columnKeys[index];
      if (key === undefined) return;
      record[key] = numericByColumn[index] ? Number(text) : text;
    });
    return record;
  });

  return { type: "DataTable", props: withCaption({ columns, rows }, caption) };
}

function isNumericColumn(columnTexts: string[][], columnIndex: number): boolean {
  return columnTexts.every((cells) => {
    const text = cells[columnIndex];
    return text !== undefined && NUMERIC_CELL_PATTERN.test(text);
  });
}

function uniqueColumnKeys(headers: string[]): string[] {
  const used = new Set<string>();
  return headers.map((header, index) => {
    const base = slugifyHeader(header, index);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function slugifyHeader(header: string, index: number): string {
  const slug = header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug.length > 0 ? slug : `col_${index + 1}`;
}

// ---- shadcn Table fallback --------------------------------------------------

function compileFallbackTable(headers: string[], bodyRows: Element[], caption: string | null): CompiledTable {
  const rows = bodyRows.map((row) => rowCells(row).map(collapsedTextOf));
  return { type: "Table", props: withCaption({ columns: headers, rows }, caption) };
}

function withCaption(props: Record<string, unknown>, caption: string | null): Record<string, unknown> {
  if (caption === null) return props;
  return { ...props, caption };
}
