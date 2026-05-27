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

export const DataTableColumnSchema = z.object({
  key: z.string().describe("Key in each row's record."),
  header: z.string().describe("Display label for the column."),
  type: ColumnTypeSchema.optional().describe("Hint for sorting/alignment. Default 'string'."),
  align: z.enum(["left", "right", "center"]).optional(),
  width: z.string().optional().describe("CSS width, e.g. '120px' or '20%'."),
});

export const DataTablePropsSchema = z.object({
  caption: z.string().optional(),
  columns: z.array(DataTableColumnSchema).describe("Column definitions in display order."),
  rows: z.array(z.record(z.string(), z.unknown())).describe("Row-oriented data; each element is a record keyed by column.key."),
  editable: z.boolean().optional().describe("If true, cells become inline-editable; edits flow back via UserPromptSubmit as table-edit."),
  exportable: z.boolean().optional().describe("If true (default), show a CSV export button in the table header."),
});

export const DataTableDefinition = {
  props: DataTablePropsSchema,
  description: "Sortable data table with CSV export, optional inline cell editing. Use for tabular data: query results, schedules, manifests, anything where columns + rows is the right shape.",
} as const;
