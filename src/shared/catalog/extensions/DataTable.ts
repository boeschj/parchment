import * as z from "zod/v4";

export const DataTableColumnType = {
  String: "string",
  Number: "number",
  Date: "date",
  Boolean: "boolean",
} as const;

const ColumnTypeSchema = z.enum([
  DataTableColumnType.String,
  DataTableColumnType.Number,
  DataTableColumnType.Date,
  DataTableColumnType.Boolean,
]);

export const DataTableAlign = {
  Left: "left",
  Right: "right",
  Center: "center",
} as const;

const AlignSchema = z.enum([
  DataTableAlign.Left,
  DataTableAlign.Right,
  DataTableAlign.Center,
]);

export const DataTableColumnSchema = z.object({
  key: z.string().describe("Key in each row's record. Must exist in every row."),
  header: z.string().describe("Display label for the column."),
  type: ColumnTypeSchema.optional().describe(
    "Hint for the sort comparator. 'number' sorts numerically; 'date' sorts chronologically; 'boolean' sorts false→true; default 'string' sorts alphabetically.",
  ),
  align: AlignSchema.optional().describe(
    "Cell text alignment. Default 'left'. Use 'right' for numeric columns.",
  ),
  width: z
    .string()
    .optional()
    .describe("CSS width: '120px', '20%', '12rem'. Omit for auto-sizing."),
});

export const DataTablePropsSchema = z.object({
  caption: z
    .string()
    .optional()
    .describe(
      "Table title shown in the header. Omit when surrounded by a Card with its own title.",
    ),
  columns: z
    .array(DataTableColumnSchema)
    .describe(
      "Column definitions in display order. The `key` of each column must match a field in every row of `rows`.",
    ),
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .describe(
      "Row-oriented data; each element is an object keyed by `columns[i].key`. Example: columns=[{key:'q',header:'Query'},{key:'ms',header:'p99 ms',type:'number'}], rows=[{q:'SELECT * FROM ...',ms:1240}].",
    ),
  editable: z
    .boolean()
    .optional()
    .describe(
      "Default false. When true, cells become inline-editable; edits flow back via canvas-edit table-edit blocks on your next turn.",
    ),
  exportable: z
    .boolean()
    .optional()
    .describe("Default true. Show a CSV export button in the table header."),
});

export const DataTableDefinition = {
  props: DataTablePropsSchema,
  slots: [],
  events: ["change", "sort"],
  description:
    "USE FOR: tabular data with columns × rows shape — query results, schedules, manifests, financial line items, log entries, any flat record set. Sortable headers (type-aware), CSV export by default, optional inline cell edit. DO NOT USE FOR: 2-3 metric tiles (use a Grid of Cards instead); for visualizing trends (use Chart). For both detail + summary, pair DataTable with a Chart inside a Stack.",
  example: {
    caption: "Slowest queries (last 24h)",
    exportable: true,
    columns: [
      { key: "query", header: "Query" },
      {
        key: "p99",
        header: "p99 (ms)",
        type: DataTableColumnType.Number,
        align: DataTableAlign.Right,
      },
      {
        key: "calls",
        header: "Calls",
        type: DataTableColumnType.Number,
        align: DataTableAlign.Right,
      },
    ],
    rows: [
      { query: "SELECT * FROM orders WHERE customer_id = $1", p99: 1240, calls: 8421 },
      { query: "SELECT u.* FROM users u JOIN sessions s ON ...", p99: 980, calls: 5102 },
      { query: "UPDATE inventory SET count = ...", p99: 612, calls: 3201 },
    ],
  },
};
