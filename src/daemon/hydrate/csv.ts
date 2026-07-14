// A small, correct CSV reader for the $csv reference. Handles quoted fields,
// commas and newlines inside quotes, and "" escapes; the first row is the
// header and becomes each row object's keys. Numeric-looking cells are coerced
// to numbers so Chart series and DataTable number columns work without a second
// pass. No dependency: the CSV shapes parchment hydrates are small and flat,
// and a streaming CSV library would be more surface than the grammar needs.

export type CsvRow = Record<string, string | number>;

export type CsvParseResult = {
  columns: string[];
  rows: CsvRow[];
};

const QUOTE = '"';
const COMMA = ",";
const CARRIAGE_RETURN = "\r";
const NEWLINE = "\n";

export function parseCsv(text: string): CsvParseResult {
  const records = splitRecords(text);
  if (records.length === 0) return { columns: [], rows: [] };
  const columns = records[0]!;
  const rows = records.slice(1).map((fields) => rowFromFields(columns, fields));
  return { columns, rows };
}

function rowFromFields(columns: string[], fields: string[]): CsvRow {
  const row: CsvRow = {};
  for (let index = 0; index < columns.length; index += 1) {
    const key = columns[index]!;
    row[key] = coerceCell(fields[index] ?? "");
  }
  return row;
}

const NUMERIC_CELL_PATTERN = /^-?\d+(\.\d+)?$/;

function coerceCell(cell: string): string | number {
  if (NUMERIC_CELL_PATTERN.test(cell.trim()) && cell.trim().length > 0) {
    return Number(cell.trim());
  }
  return cell;
}

// One left-to-right pass over the characters: a quote toggles quoted mode, a
// comma or newline outside quotes ends a field or record. Fully-blank trailing
// records (a final newline) are dropped.
function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index]!;
    if (inQuotes) {
      if (char === QUOTE && text[index + 1] === QUOTE) {
        field += QUOTE;
        index += 2;
        continue;
      }
      if (char === QUOTE) {
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === QUOTE) {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === COMMA) {
      fields.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === NEWLINE || char === CARRIAGE_RETURN) {
      fields.push(field);
      records.push(fields);
      fields = [];
      field = "";
      index += char === CARRIAGE_RETURN && text[index + 1] === NEWLINE ? 2 : 1;
      continue;
    }
    field += char;
    index += 1;
  }

  const hasTrailingField = field.length > 0 || fields.length > 0;
  if (hasTrailingField) {
    fields.push(field);
    records.push(fields);
  }
  return records.filter((record) => !isBlankRecord(record));
}

function isBlankRecord(record: string[]): boolean {
  return record.length === 1 && record[0] === "";
}
