import { Maximize, Minimize, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { Panel, useReactFlow, useStore } from "reactflow";
import { Button } from "../../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
const ANIMATION = { duration: 150 };

function ToolButton({ label, shortcut, onClick, disabled, children, className, ...rest }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className={cn("h-8 w-8", className)} onClick={onClick} disabled={disabled} aria-label={label} {...rest}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? <span className="ml-1.5 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

// Zoom in / zoom out / zoom % (click = back to 100%) / fit to screen / fullscreen, bottom-right of the map.
// Rendered inside <ReactFlow> so it can use the React Flow hooks. The parent owns fullscreen and "has the user moved the map".
export function MapToolbar({ expanded, onToggleFullscreen, onFit, onUserZoom }) {
  const { zoomIn, zoomOut, zoomTo } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const percent = Math.round(zoom * 100);

  return (
    <Panel position="bottom-right">
      <div role="toolbar" aria-label="Map zoom controls" className="flex items-center gap-0.5 rounded-lg border border-border bg-card/95 p-1 shadow-md backdrop-blur">
        <ToolButton label="Zoom in" shortcut="+" disabled={zoom >= MAX_ZOOM - 0.001} onClick={() => { onUserZoom(); zoomIn(ANIMATION); }}>
          <ZoomIn className="h-4 w-4" />
        </ToolButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 min-w-[3.4rem] px-2 font-mono text-xs"
              onClick={() => { onUserZoom(); zoomTo(1, ANIMATION); }}
              aria-label={`Zoom ${percent} percent. Reset to 100 percent`}
            >
              {percent}%
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset to 100%</TooltipContent>
        </Tooltip>
        <ToolButton label="Zoom out" shortcut="-" disabled={zoom <= MIN_ZOOM + 0.001} onClick={() => { onUserZoom(); zoomOut(ANIMATION); }}>
          <ZoomOut className="h-4 w-4" />
        </ToolButton>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
        <ToolButton label="Fit to screen" shortcut="0" onClick={onFit}>
          <Scan className="h-4 w-4" />
        </ToolButton>
        {expanded ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="sm" className="ml-0.5 h-8 gap-1.5 px-2.5 text-xs" onClick={onToggleFullscreen} aria-label="Exit fullscreen">
                <Minimize className="h-4 w-4" />
                Exit fullscreen
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Exit fullscreen<span className="ml-1.5 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">F / Esc</span>
            </TooltipContent>
          </Tooltip>
        ) : (
          <ToolButton label="Fullscreen" shortcut="F" onClick={onToggleFullscreen} aria-pressed="false">
            <Maximize className="h-4 w-4" />
          </ToolButton>
        )}
      </div>
    </Panel>
  );
}
