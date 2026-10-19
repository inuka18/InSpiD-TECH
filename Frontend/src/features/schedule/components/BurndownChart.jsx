import { useMemo, useState } from "react";
import {
  computeBurndownSeries,
  isTaskActiveOn,
  overlapsRange,
  startOfWeek,
  endOfDay,
  addDays,
  isSameDay,
  formatShortDate,
  TODAY,
} from "../lib/scheduleUtils";
import { cn } from "../../../lib/utils";

const CHART_W = 480;
const LEFT_PAD = 34;
const RIGHT_PAD = 10;
const TOP_PAD = 14;
const BOTTOM_PAD = 24;
const Y_TICKS = 4;

const LEVELS = [
  { key: "sprint", label: "Sprint", swatchClass: "bg-status-confirmed-fg", defaultOn: true },
  { key: "week", label: "Week", swatchClass: "bg-primary/60", defaultOn: false },
  { key: "day", label: "Day", swatchClass: "bg-primary/30", defaultOn: false },
];

function dayPool(tasks, day) {
  return tasks.filter((task) => isTaskActiveOn(task, day));
}

function weekPool(tasks, day) {
  const weekStart = startOfWeek(day);
  return tasks.filter((task) => overlapsRange(task, weekStart, endOfDay(addDays(weekStart, 6))));
}

export function BurndownChart({ tasks, rangeStart, rangeEnd, onSelectDay, highlightDate, height = 220 }) {
  const [enabled, setEnabled] = useState(() => Object.fromEntries(LEVELS.map((level) => [level.key, level.defaultOn])));
  const sprintSeries = useMemo(() => computeBurndownSeries(tasks, rangeStart, rangeEnd), [tasks, rangeStart, rangeEnd]);
  const weekSeries = useMemo(
    () => (enabled.week ? computeBurndownSeries(tasks, rangeStart, rangeEnd, { poolForDay: (day) => weekPool(tasks, day) }) : null),
    [tasks, rangeStart, rangeEnd, enabled.week]
  );
  const daySeries = useMemo(
    () => (enabled.day ? computeBurndownSeries(tasks, rangeStart, rangeEnd, { poolForDay: (day) => dayPool(tasks, day) }) : null),
    [tasks, rangeStart, rangeEnd, enabled.day]
  );

  const count = sprintSeries.length;
  const plotW = CHART_W - LEFT_PAD - RIGHT_PAD;
  const plotH = height - TOP_PAD - BOTTOM_PAD;
  const maxValue = Math.max(1, ...sprintSeries.map((point) => Math.max(point.planned, point.actual ?? 0)));
  const xAt = (index) => LEFT_PAD + (count <= 1 ? 0 : (index / (count - 1)) * plotW);
  const yAt = (value) => TOP_PAD + (1 - value / maxValue) * plotH;
  const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, index) => Math.round((maxValue / Y_TICKS) * index));
  const xTickEvery = count <= 10 ? 1 : Math.ceil(count / 8);
  const todayIndex = sprintSeries.findIndex((point) => isSameDay(point.date, TODAY));
  const highlightIndex = highlightDate ? sprintSeries.findIndex((point) => isSameDay(point.date, highlightDate)) : -1;
  const showHighlight = highlightIndex >= 0 && highlightIndex !== todayIndex;
  const clickable = Boolean(onSelectDay);
  const knownPoints = sprintSeries.map((point, index) => ({ ...point, index })).filter((point) => point.actual != null);
  const latest = knownPoints[knownPoints.length - 1] ?? null;

  const linePath = (series, key) => series
    .map((point, index) => (point[key] == null ? null : `${xAt(index)},${yAt(point[key])}`))
    .filter(Boolean)
    .join(" ");

  const totalPoints = tasks.reduce((sum, task) => sum + (task.storyPoints || 0), 0);
  let varianceText = "No data yet, this window has not started.";
  let projectedText = "N/A";
  if (latest) {
    const difference = Math.round((latest.actual - latest.planned) * 10) / 10;
    varianceText = difference > 0.5 ? `+${difference} pts behind plan` : difference < -0.5 ? `${Math.abs(difference)} pts ahead of plan` : "On track";
    const daysElapsed = Math.max(latest.index, 1);
    const burned = totalPoints - latest.actual;
    const velocity = burned / daysElapsed;
    if (velocity > 0 && latest.actual > 0) projectedText = formatShortDate(addDays(new Date(latest.date), Math.ceil(latest.actual / velocity)));
    else if (latest.actual <= 0) projectedText = "Done";
    else projectedText = "Insufficient velocity yet";
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <svg width="14" height="8" className="shrink-0" aria-hidden="true">
            <line x1="0" y1="4" x2="14" y2="4" className="stroke-foreground" strokeWidth={2} strokeDasharray="3,2" />
          </svg>
          Planned
        </span>
        {LEVELS.map((level) => (
          <button
            key={level.key}
            type="button"
            onClick={() => setEnabled((previous) => ({ ...previous, [level.key]: !previous[level.key] }))}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
              enabled[level.key] ? "border-primary/40 bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", level.swatchClass)} />
            {level.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <svg width="100%" viewBox={`0 0 ${CHART_W} ${height}`} className="min-w-[260px]" style={{ aspectRatio: `${CHART_W} / ${height}`, height: "auto" }}>
          {yTicks.map((value) => (
            <g key={value}>
              <line x1={LEFT_PAD} y1={yAt(value)} x2={CHART_W - RIGHT_PAD} y2={yAt(value)} className="stroke-border" strokeWidth={1} strokeDasharray="2,3" />
              <text x={LEFT_PAD - 5} y={yAt(value) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">{value}</text>
            </g>
          ))}

          {sprintSeries.map((point, index) => index % xTickEvery === 0 ? (
            <text key={point.date} x={xAt(index)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[9px]">{formatShortDate(point.date)}</text>
          ) : null)}

          {showHighlight && <line x1={xAt(highlightIndex)} y1={TOP_PAD} x2={xAt(highlightIndex)} y2={height - BOTTOM_PAD} className="stroke-status-atrisk-fg" strokeWidth={2} strokeDasharray="1,2" />}
          {todayIndex >= 0 && (
            <g>
              <line x1={xAt(todayIndex)} y1={TOP_PAD} x2={xAt(todayIndex)} y2={height - BOTTOM_PAD} className="stroke-primary/70" strokeWidth={1.5} />
              <text x={xAt(todayIndex)} y={TOP_PAD - 4} textAnchor="middle" className="fill-primary text-[8px] font-semibold">TODAY</text>
            </g>
          )}

          {daySeries && <polyline points={linePath(daySeries, "actual")} fill="none" className="stroke-primary/30" strokeWidth={1.5} />}
          {weekSeries && <polyline points={linePath(weekSeries, "actual")} fill="none" className="stroke-primary/60" strokeWidth={1.5} />}
          <polyline points={linePath(sprintSeries, "planned")} fill="none" className="stroke-foreground" strokeWidth={2} strokeDasharray="4,3" />

          {enabled.sprint && sprintSeries.slice(1).map((point, index) => {
            const currentIndex = index + 1;
            const previous = sprintSeries[currentIndex - 1];
            if (previous.actual == null || point.actual == null) return null;
            return (
              <line
                key={point.date}
                x1={xAt(currentIndex - 1)}
                y1={yAt(previous.actual)}
                x2={xAt(currentIndex)}
                y2={yAt(point.actual)}
                className={point.actual > point.planned ? "stroke-status-dropped-fg" : "stroke-status-confirmed-fg"}
                strokeWidth={2.5}
              />
            );
          })}

          {enabled.sprint && knownPoints.map((point) => (
            <circle
              key={point.date}
              cx={xAt(point.index)}
              cy={yAt(point.actual)}
              r={clickable ? 4 : 3}
              className={cn(point.actual > point.planned ? "fill-status-dropped-fg" : "fill-status-confirmed-fg", clickable && "cursor-pointer")}
              onClick={clickable ? () => onSelectDay(new Date(point.date)) : undefined}
            >
              <title>{formatShortDate(point.date)}: {point.actual} remaining (planned {point.planned})</title>
            </circle>
          ))}
        </svg>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border border-border bg-muted/30 p-2">
          <p className={cn("text-sm font-bold", varianceText.includes("behind") ? "text-status-dropped-fg" : "text-status-confirmed-fg")}>{varianceText}</p>
          <p className="text-[10px] text-muted-foreground">Current Variance</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-2">
          <p className="text-sm font-bold text-foreground">{projectedText}</p>
          <p className="text-[10px] text-muted-foreground">Projected Completion</p>
        </div>
      </div>

      {clickable && <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Click a point to see that day&apos;s task breakdown.</p>}
    </div>
  );
}
