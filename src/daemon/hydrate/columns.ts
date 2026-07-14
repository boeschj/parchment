// The CSV header, read as a DataTable's shape. A `<DataTable src="results.csv"/>`
// carries no `columns` because the model has not opened results.csv — the daemon
// has. This is where the file's first row becomes the table: one column per
// header cell, in file order, keyed exactly as parseCsv keys the row objects it
// built from that same header.
//
// The type/alignment hint is read off the PARSED cells, not guessed from the
// header text: parseCsv already coerced numeric-looking cells to numbers, so a
// column whose cells all came back numbers is a number column — it sorts
// numerically and sits right-aligned, the way a hand-authored DataTable would
// write it.

import type { z } from "zod/v4";
import {
  DataTableAlign,
  DataTableColumnSchema,
  DataTableColumnType,
} from "../../shared/catalog/extensions/DataTable.ts";
import type { CsvParseResult, CsvRow } from "./csv.ts";

type DataTableColumn = z.infer<typeof DataTableColumnSchema>;

const EMPTY_CELL = "";

export function dataTableColumnsFromCsv(csv: CsvParseResult): DataTableColumn[] {
  return csv.columns.map((header) => columnFromHeader(header, csv.rows));
}

// The header cell is both the key (parseCsv keys each row by it) and the label
// (it is what the file's author called the column — rewriting it would invent
// information the file does not carry).
function columnFromHeader(header: string, rows: CsvRow[]): DataTableColumn {
  const column: DataTableColumn = { key: header, header };
  if (!isNumericColumn(header, rows)) return column;
  return { ...column, type: DataTableColumnType.Number, align: DataTableAlign.Right };
}

// Numeric when every cell that HAS a value parsed as a number. Blank cells carry
// no evidence either way, and a column with no values at all is not a number
// column — it is an empty one.
function isNumericColumn(header: string, rows: CsvRow[]): boolean {
  const cells = rows.map((row) => row[header]).filter(isPresentCell);
  if (cells.length === 0) return false;
  return cells.every((cell) => typeof cell === "number");
}

function isPresentCell(cell: string | number | undefined): cell is string | number {
  return cell !== undefined && cell !== EMPTY_CELL;
}
