import { useRef, useState } from "react";
import { Diamond } from "lucide-react";
import { statusBarClass } from "../lib/scheduleUtils";
import { cn } from "../../../lib/utils";

export function TaskBar({ task, rangeStart, rangeEnd, onClick, draggable, onReschedule, containerRef, totalDays, pxPerDay, rowHeight = 48 }) {
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  const pct = (date) => {
    const clamped = Math.min(Math.max(new Date(date).getTime(), rangeStart.getTime()), rangeEnd.getTime());
    return ((clamped - rangeStart.getTime()) / totalMs) * 100;
  };

  const barLeft   = pct(task.start);
  const barRight  = pct(task.end);
  const baseLeft  = pct(task.baselineStart);
  const baseRight = pct(task.baselineEnd);
  const barWidth  = Math.max(barRight - barLeft,  0.5);
  const baseWidth = Math.max(baseRight - baseLeft, 0.5);
  const progressWidth = Math.min(Math.max(task.progress || 0, 0), 100);

  // Vertical positions relative to row height
  const baselineTop = Math.round(rowHeight * 0.15);
  const barTop      = Math.round(rowHeight * 0.38);
  const barH        = Math.round(rowHeight * 0.4);

  const [dragPx, setDragPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragPxRef  = useRef(0);
  const startXRef  = useRef(0);
  const pxPerDayRef = useRef(20);

  const handlePointerMove = (e) => {
    const dx = e.clientX - startXRef.current;
    dragPxRef.current = dx;
    setDragPx(dx);
  };
  const handlePointerUp = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    setIsDragging(false);
    const movedPx  = Math.abs(dragPxRef.current);
    const deltaDays = Math.round(dragPxRef.current / pxPerDayRef.current);
    setDragPx(0);
    if (movedPx < 3) onClick?.(task);
    else if (deltaDays !== 0) onReschedule?.(task, deltaDays);
  };
  const handlePointerDown = (e) => {
    e.stopPropagation();
    startXRef.current = e.clientX;
    pxPerDayRef.current = pxPerDay ?? ((containerRef?.current?.getBoundingClientRect().width || totalDays * 20) / (totalDays || 1));
    dragPxRef.current = 0;
    setIsDragging(true);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <div className="relative w-full" style={{ height: rowHeight }}>

      {/* Baseline ghost track */}
      {baseWidth > 0.3 && (
        <div
          className="absolute h-[4px] rounded-full border border-dashed border-muted-foreground/35 bg-muted-foreground/10"
          style={{ left: `${baseLeft}%`, width: `${baseWidth}%`, top: baselineTop }}
          title={`Baseline: ${task.baselineStart} – ${task.baselineEnd}`}
        />
      )}

      {/* Actual task bar */}
      <button
        type="button"
        onClick={!draggable ? () => onClick?.(task) : undefined}
        onPointerDown={draggable ? handlePointerDown : undefined}
        aria-label={`${task.name}, ${task.progress || 0}% complete`}
        title={`${task.name} · ${task.progress || 0}% complete · ${new Date(task.start).toLocaleDateString()} – ${new Date(task.end).toLocaleDateString()}`}
        className={cn(
          "absolute flex items-center overflow-hidden rounded-md border border-white/20 text-left text-[10px] font-semibold leading-none text-white shadow-sm transition-all",
          !isDragging && "hover:z-10 hover:brightness-110 hover:shadow-md",
          isDragging ? "z-20 cursor-grabbing shadow-lg opacity-90" : draggable ? "cursor-grab" : "cursor-pointer",
          statusBarClass(task)
        )}
        style={{
          left: `${barLeft}%`,
          width: `${barWidth}%`,
          top: barTop,
          height: barH,
          transform: dragPx ? `translateX(${dragPx}px)` : undefined,
        }}
      >
        {/* Progress fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-md bg-white/20"
          style={{ width: `${progressWidth}%` }}
        />
        <span className="relative truncate px-2">{task.name}</span>
      </button>

      {task.milestone && (
        <Diamond
          className="absolute h-3.5 w-3.5 fill-primary text-primary drop-shadow-sm"
          style={{ left: `calc(${barRight}% - 7px)`, top: barTop - 2 }}
        />
      )}
    </div>
  );
}
