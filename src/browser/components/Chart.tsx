import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { z } from "zod/v4";
import { ChartKind, ChartPropsSchema } from "../../shared/catalog/extensions/Chart.ts";

type ChartProps = z.infer<typeof ChartPropsSchema>;
type RenderProps = { props: ChartProps };
type ChartRow = Record<string, unknown>;

// Chart series follow the Style Guide palette: gold first, then the ink
// ramp — charts stay monochrome apart from the single brand accent.
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const AXIS_FONT_SIZE = 12;
const BAR_LABEL_FONT_SIZE = 11;
const MAX_BARS_WITH_VALUE_LABELS = 12;
const MIN_BAR_POINT_SIZE = 2;
const LONG_X_LABEL_CHARS = 10;
const BOTTOM_MARGIN_DEFAULT = 4;
const BOTTOM_MARGIN_LONG_LABELS = 24;

const COMPACT_NUMBER = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCompactNumber(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return COMPACT_NUMBER.format(numeric);
}

function colorAt(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? "#888";
}

function toSeriesKeys(y: string | string[]): string[] {
  return Array.isArray(y) ? y : [y];
}

function bottomMarginFor(rows: ChartRow[], xKey: string): number {
  const longestLabelChars = rows.reduce((longest, row) => {
    const labelChars = String(row[xKey] ?? "").length;
    return Math.max(longest, labelChars);
  }, 0);
  return longestLabelChars > LONG_X_LABEL_CHARS
    ? BOTTOM_MARGIN_LONG_LABELS
    : BOTTOM_MARGIN_DEFAULT;
}

export function Chart({ props }: RenderProps) {
  const height = props.height ?? 320;
  const seriesKeys = toSeriesKeys(props.y);

  return (
    <div
      className="bg-card text-card-foreground p-6"
      style={{ borderRadius: "var(--radius)" }}
    >
      {props.title ? (
        <header className="mb-4">
          <h2 className="text-base font-semibold tracking-tight">{props.title}</h2>
        </header>
      ) : null}
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(props, seriesKeys)}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function renderChart(
  props: ChartProps,
  seriesKeys: string[],
): React.ReactElement {
  const rows = props.data as ChartRow[];
  const showLegend = seriesKeys.length > 1;
  const chartMargin = { bottom: bottomMarginFor(rows, props.x) };

  switch (props.kind) {
    case ChartKind.Line:
      return (
        <LineChart data={rows} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" />
          <XAxis dataKey={props.x} fontSize={AXIS_FONT_SIZE} tickLine={false} axisLine={false} />
          <YAxis
            fontSize={AXIS_FONT_SIZE}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCompactNumber}
          />
          <Tooltip />
          {showLegend ? <Legend /> : null}
          {seriesKeys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colorAt(index)}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </LineChart>
      );
    case ChartKind.Bar: {
      const showValueLabels = rows.length <= MAX_BARS_WITH_VALUE_LABELS;
      return (
        <BarChart data={rows} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" />
          <XAxis dataKey={props.x} fontSize={AXIS_FONT_SIZE} tickLine={false} axisLine={false} />
          <YAxis
            fontSize={AXIS_FONT_SIZE}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCompactNumber}
          />
          <Tooltip />
          {showLegend ? <Legend /> : null}
          {seriesKeys.map((key, index) => (
            <Bar key={key} dataKey={key} fill={colorAt(index)} minPointSize={MIN_BAR_POINT_SIZE}>
              {showValueLabels ? (
                <LabelList
                  dataKey={key}
                  position="top"
                  fontSize={BAR_LABEL_FONT_SIZE}
                  fill="var(--muted-foreground)"
                  formatter={formatCompactNumber}
                />
              ) : null}
            </Bar>
          ))}
        </BarChart>
      );
    }
    case ChartKind.Area:
      return (
        <AreaChart data={rows} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" />
          <XAxis dataKey={props.x} fontSize={AXIS_FONT_SIZE} tickLine={false} axisLine={false} />
          <YAxis
            fontSize={AXIS_FONT_SIZE}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCompactNumber}
          />
          <Tooltip />
          {showLegend ? <Legend /> : null}
          {seriesKeys.map((key, index) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colorAt(index)}
              fill={colorAt(index)}
              fillOpacity={0.3}
            />
          ))}
        </AreaChart>
      );
    case ChartKind.Pie:
      return (
        <PieChart>
          <Tooltip />
          <Legend />
          <Pie
            data={rows}
            dataKey={seriesKeys[0] ?? "value"}
            nameKey={props.x}
            outerRadius="70%"
            label
          >
            {rows.map((_, index) => (
              <Cell key={`cell-${index}`} fill={colorAt(index)} />
            ))}
          </Pie>
        </PieChart>
      );
    case ChartKind.Scatter:
      return (
        <ScatterChart margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" />
          <XAxis
            dataKey={props.x}
            fontSize={AXIS_FONT_SIZE}
            type="number"
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCompactNumber}
          />
          <YAxis
            dataKey={seriesKeys[0] ?? "y"}
            fontSize={AXIS_FONT_SIZE}
            type="number"
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCompactNumber}
          />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          {showLegend ? <Legend /> : null}
          <Scatter data={rows} fill={colorAt(0)} />
        </ScatterChart>
      );
    default: {
      const kindLabel = (props as { kind: string }).kind;
      return <div className="text-destructive text-sm">Unsupported chart kind: {kindLabel}</div>;
    }
  }
}
