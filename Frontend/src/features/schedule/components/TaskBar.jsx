import { useRef, useState } from "react";
import { Diamond } from "lucide-react";
import { isLate } from "../lib/scheduleUtils";
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
  const barColor = isLate(task)
    ? "bg-gradient-to-r from-rose-500 to-red-700"
    : task.status === "done"
    ? "bg-gradient-to-r from-emerald-500 to-emerald-700"
    : task.status === "review"
      ? "bg-gradient-to-r from-amber-400 to-amber-600"
      : task.status === "in-progress"
        ? "bg-gradient-to-r from-blue-500 to-blue-700"
        : "bg-gradient-to-r from-slate-400 to-slate-500";

  // Vertical positions relative to row height
  const baselineTop = Math.round(rowHeight * 0.13);
  const barH        = Math.round(rowHeight * 0.4);
  const barTop      = Math.round((rowHeight - barH) / 2);

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
      {!task.milestone && baseWidth > 0.3 && (
        <div
          className="absolute h-[3px] rounded-full border border-dashed border-slate-400/50 bg-slate-300/30"
          style={{ left: `${baseLeft}%`, width: `${baseWidth}%`, top: baselineTop }}
          title={`Baseline: ${task.baselineStart} – ${task.baselineEnd}`}
        />
      )}

      {/* Actual task bar */}
      {!task.milestone && <button
        type="button"
        onClick={!draggable ? () => onClick?.(task) : undefined}
        onKeyDown={draggable ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick?.(task);
          }
        } : undefined}
        onPointerDown={draggable ? handlePointerDown : undefined}
        aria-label={`${task.name}, ${task.progress || 0}% complete`}
        title={`${task.name} · ${task.progress || 0}% complete · ${new Date(task.start).toLocaleDateString()} – ${new Date(task.end).toLocaleDateString()}`}
        className={cn(
          "absolute flex items-center overflow-hidden rounded-full border border-white/35 text-left text-[10px] font-semibold leading-none tracking-[0.01em] text-white ring-1 ring-inset ring-black/10 shadow-[0_2px_5px_rgb(16_24_40_/_18%)] transition-[filter,box-shadow,transform] duration-150",
          !isDragging && "hover:z-10 hover:brightness-110 hover:shadow-[0_4px_10px_rgb(16_24_40_/_24%)]",
          isDragging ? "z-20 cursor-grabbing shadow-lg opacity-90" : draggable ? "cursor-grab" : "cursor-pointer",
          barColor
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
          className="absolute inset-y-0 left-0 rounded-full bg-white/25 shadow-[inset_-1px_0_0_rgb(255_255_255_/_20%)]"
          style={{ width: `${progressWidth}%` }}
        />
        <span className="relative truncate px-2">{task.name}</span>
      </button>}

      {task.milestone && <Diamond className="absolute z-10 h-5 w-5 fill-amber-400 text-amber-700 drop-shadow-md" style={{ left: `calc(${barRight}% - 10px)`, top: Math.round((rowHeight - 20) / 2) }} aria-label={`${task.name} milestone`} role="img" />}
    </div>
  );
}
