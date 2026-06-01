import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

const SERIES_COLORS = [
  "oklch(0.55 0.20 255)",
  "oklch(0.60 0.18 145)",
  "oklch(0.65 0.18 60)",
  "oklch(0.55 0.20 25)",
  "oklch(0.60 0.18 305)",
  "oklch(0.55 0.18 195)",
];

function colorAt(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? "#888";
}

function toSeriesKeys(y: string | string[]): string[] {
  return Array.isArray(y) ? y : [y];
}

export function Chart({ props }: RenderProps) {
  const height = props.height ?? 320;
  const seriesKeys = toSeriesKeys(props.y);

  return (
    <div
      className="bg-card text-card-foreground p-6"
      style={{ borderRadius: "var(--radius)", boxShadow: "var(--shadow-card)" }}
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
  switch (props.kind) {
    case ChartKind.Line:
      return (
        <LineChart data={props.data as Array<Record<string, unknown>>}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.005 250)" />
          <XAxis dataKey={props.x} fontSize={12} />
          <YAxis fontSize={12} />
          <Tooltip />
          <Legend />
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
    case ChartKind.Bar:
      return (
        <BarChart data={props.data as Array<Record<string, unknown>>}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.005 250)" />
          <XAxis dataKey={props.x} fontSize={12} />
          <YAxis fontSize={12} />
          <Tooltip />
          <Legend />
          {seriesKeys.map((key, index) => (
            <Bar key={key} dataKey={key} fill={colorAt(index)} />
          ))}
        </BarChart>
      );
    case ChartKind.Area:
      return (
        <AreaChart data={props.data as Array<Record<string, unknown>>}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.005 250)" />
          <XAxis dataKey={props.x} fontSize={12} />
          <YAxis fontSize={12} />
          <Tooltip />
          <Legend />
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
            data={props.data as Array<Record<string, unknown>>}
            dataKey={seriesKeys[0] ?? "value"}
            nameKey={props.x}
            outerRadius="70%"
            label
          >
            {(props.data as Array<Record<string, unknown>>).map((_, index) => (
              <Cell key={`cell-${index}`} fill={colorAt(index)} />
            ))}
          </Pie>
        </PieChart>
      );
    case ChartKind.Scatter:
      return (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.005 250)" />
          <XAxis dataKey={props.x} fontSize={12} type="number" />
          <YAxis dataKey={seriesKeys[0] ?? "y"} fontSize={12} type="number" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Legend />
          <Scatter data={props.data as Array<Record<string, unknown>>} fill={colorAt(0)} />
        </ScatterChart>
      );
    default: {
      const kindLabel = (props as { kind: string }).kind;
      return <div className="text-destructive text-sm">Unsupported chart kind: {kindLabel}</div>;
    }
  }
}
