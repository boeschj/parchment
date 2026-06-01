import { useMemo, useState } from "react";
import type { z } from "zod/v4";
import { EditKind } from "../../shared/types.ts";
import {
  DataTableColumnType,
  DataTablePropsSchema,
} from "../../shared/catalog/extensions/DataTable.ts";
import { useSlotContext } from "../SlotContext.tsx";
import { postEdit } from "../api.ts";

type DataTableProps = z.infer<typeof DataTablePropsSchema>;
type RenderProps = { props: DataTableProps };

const SortDirection = { Asc: "asc", Desc: "desc" } as const;
type SortDirection = (typeof SortDirection)[keyof typeof SortDirection];

type SortState = { key: string; direction: SortDirection } | null;

function compareValues(a: unknown, b: unknown, type: string | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (type === DataTableColumnType.Number) {
    return Number(a) - Number(b);
  }
  if (type === DataTableColumnType.Date) {
    return new Date(String(a)).valueOf() - new Date(String(b)).valueOf();
  }
  if (type === DataTableColumnType.Boolean) {
    return Number(Boolean(a)) - Number(Boolean(b));
  }
  return String(a).localeCompare(String(b));
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function rowsToCsv(columns: DataTableProps["columns"], rows: DataTableProps["rows"]): string {
  const headers = columns.map((column) => csvCell(column.header));
  const body = rows.map((row) =>
    columns.map((column) => csvCell(formatCell(row[column.key]))).join(","),
  );
  return [headers.join(","), ...body].join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function triggerCsvDownload(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function DataTable({ props }: RenderProps) {
  const { sessionId, slotId } = useSlotContext();
  const [sort, setSort] = useState<SortState>(null);
  const exportable = props.exportable !== false;
  const editable = props.editable === true;

  const sortedRows = useMemo(() => {
    if (!sort) return props.rows;
    const column = props.columns.find((candidate) => candidate.key === sort.key);
    if (!column) return props.rows;
    const copy = [...props.rows];
    copy.sort((rowA, rowB) => {
      const result = compareValues(rowA[sort.key], rowB[sort.key], column.type);
      return sort.direction === SortDirection.Asc ? result : -result;
    });
    return copy;
  }, [sort, props.rows, props.columns]);

  const toggleSort = (key: string): void => {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: SortDirection.Asc };
      if (current.direction === SortDirection.Asc) {
        return { key, direction: SortDirection.Desc };
      }
      return null;
    });
  };

  const handleCellEdit = async (
    rowIndex: number,
    column: DataTableProps["columns"][number],
    nextValue: string,
  ): Promise<void> => {
    try {
      await postEdit(sessionId, {
        slotId,
        elementId: `row:${rowIndex}:${column.key}`,
        kind: EditKind.TableEdit,
        payload: {
          rowIndex,
          columnKey: column.key,
          value: nextValue,
        },
      });
    } catch (error) {
      console.error("[DataTable] postEdit failed", error);
    }
  };

  return (
    <div
      className="bg-card text-card-foreground overflow-hidden"
      style={{ borderRadius: "var(--radius)", boxShadow: "var(--shadow-card)" }}
    >
      <header className="px-6 py-3 border-b flex items-center justify-between">
        {props.caption ? (
          <h2 className="text-base font-semibold tracking-tight">{props.caption}</h2>
        ) : (
          <span className="label">{props.rows.length} rows</span>
        )}
        {exportable ? (
          <button
            type="button"
            onClick={() => {
              const csv = rowsToCsv(props.columns, props.rows);
              triggerCsvDownload(`${props.caption ?? "table"}.csv`, csv);
            }}
            className="h-8 px-3 rounded-full text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            Export CSV
          </button>
        ) : null}
      </header>
      <div className="overflow-auto max-h-[600px]">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted">
              {props.columns.map((column) => {
                const direction = sort?.key === column.key ? sort.direction : null;
                return (
                  <th
                    key={column.key}
                    onClick={() => toggleSort(column.key)}
                    className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide cursor-pointer select-none border-b"
                    style={{ textAlign: column.align ?? "left", width: column.width ?? "auto" }}
                  >
                    {column.header}
                    {direction === SortDirection.Asc ? " ↑" : null}
                    {direction === SortDirection.Desc ? " ↓" : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b last:border-b-0 hover:bg-muted/40">
                {props.columns.map((column) => (
                  <td
                    key={column.key}
                    className="px-3 py-2 align-top"
                    style={{ textAlign: column.align ?? "left" }}
                  >
                    {editable ? (
                      <input
                        type="text"
                        defaultValue={formatCell(row[column.key])}
                        onBlur={(event) => {
                          const next = event.target.value;
                          if (next !== formatCell(row[column.key])) {
                            handleCellEdit(rowIndex, column, next);
                          }
                        }}
                        className="w-full bg-transparent border border-transparent hover:border-border focus:border-primary rounded px-1 py-0.5 text-sm focus:outline-none"
                      />
                    ) : (
                      <span>{formatCell(row[column.key])}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
