import type { z } from "zod/v4";
import {
  SPARKLINE_DEFAULT_HEIGHT,
  SPARKLINE_DEFAULT_VALUE_KEY,
  SPARKLINE_DEFAULT_WIDTH,
  SparklinePropsSchema,
} from "../../shared/catalog/extensions/Sparkline.ts";

type SparklineProps = z.infer<typeof SparklinePropsSchema>;
type RenderProps = { props: SparklineProps };

const EDGE_PADDING_PX = 2;
const STROKE_WIDTH = 1.5;
const LAST_POINT_RADIUS = 2;

export function Sparkline({ props }: RenderProps) {
  const width = props.width ?? SPARKLINE_DEFAULT_WIDTH;
  const height = props.height ?? SPARKLINE_DEFAULT_HEIGHT;
  const stroke = `var(--chart-${props.series ?? 1})`;
  const values = toNumericValues(props.data, props.y ?? SPARKLINE_DEFAULT_VALUE_KEY);
  const points = toPolylinePoints(values, width, height);
  const lastPoint = points[points.length - 1];

  if (points.length === 0) {
    return <EmptySparkline width={width} height={height} />;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="trend sparkline"
      className="inline-block align-middle"
    >
      <polyline
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {lastPoint ? <circle cx={lastPoint.x} cy={lastPoint.y} r={LAST_POINT_RADIUS} fill={stroke} /> : null}
    </svg>
  );
}

function EmptySparkline({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <line
        x1={EDGE_PADDING_PX}
        y1={height / 2}
        x2={width - EDGE_PADDING_PX}
        y2={height / 2}
        stroke="var(--muted-foreground)"
        strokeWidth={1}
        strokeDasharray="2 3"
        opacity={0.5}
      />
    </svg>
  );
}

function toNumericValues(data: SparklineProps["data"], valueKey: string): number[] {
  const values: number[] = [];
  for (const point of data) {
    const raw = typeof point === "number" ? point : point[valueKey];
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) values.push(numeric);
  }
  return values;
}

type PolylinePoint = { x: number; y: number };

function toPolylinePoints(values: number[], width: number, height: number): PolylinePoint[] {
  if (values.length === 0) return [];

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueSpan = maxValue - minValue;
  const drawableWidth = width - EDGE_PADDING_PX * 2;
  const drawableHeight = height - EDGE_PADDING_PX * 2;
  const xStep = values.length > 1 ? drawableWidth / (values.length - 1) : 0;

  return values.map((value, index) => {
    const normalized = valueSpan === 0 ? 0.5 : (value - minValue) / valueSpan;
    return {
      x: EDGE_PADDING_PX + index * xStep,
      y: EDGE_PADDING_PX + (1 - normalized) * drawableHeight,
    };
  });
}
