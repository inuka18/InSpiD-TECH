import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HelpCircle, GitCompareArrows, Link2, Unlink, ArrowUpRight, Gauge, AlertCircle, Flag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { AlignmentTrendChart } from "./components/AlignmentTrendChart";
import { ClassificationBadge } from "./components/ClassificationBadge";
import { useAlignment } from "../../hooks/useAlignment";
import { useSignals } from "../../hooks/useSignals";
import { useActiveProject } from "../../hooks/useActiveProject";
import { bandStyle, formatBaselineDate, weeklyBreakdown } from "../../lib/alignment";
import { formatDateTime, cn } from "../../lib/utils";

function StatTile({ label, value, icon: Icon }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold leading-none text-foreground">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

// Alignment = how far the current requirement network has drifted from a frozen baseline (the Network Map page has the
// "Freeze new baseline" button). Everything here comes from GET /projects/:projectId/alignment.
export function AlignmentScorePage() {
  const { activeProjectId } = useActiveProject();
  const { data: alignment, loading, error, reload } = useAlignment(activeProjectId);
  const { data: signals } = useSignals(activeProjectId);
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(null);

  const history = useMemo(() => alignment?.history ?? [], [alignment]);
  const current = alignment?.current ?? null;
  const status = current ? bandStyle(current.band) : null;

  // Defaults to the most recent signal-linked change once the history loads, so the drill-down isn't empty on first paint;
  // clicking another marker on the chart swaps it out.
  useEffect(() => {
    if (loading || history.length === 0) return;
    const lastDriver = [...history].reverse().find((d) => d.driverSignalId);
    setSelectedDate(lastDriver?.date ?? null);
  }, [loading, history]);

  const breakdown = useMemo(() => weeklyBreakdown(history), [history]);
  const selectedEntry = history.find((d) => d.date === selectedDate) ?? null;
  const drivingSignal = selectedEntry?.driverSignalId ? signals.find((s) => s.id === selectedEntry.driverSignalId) ?? null : null;

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <AlertCircle className="h-6 w-6 text-status-dropped-fg" />
          <p className="text-sm font-medium text-foreground">Could not load the alignment score.</p>
          <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
          <button onClick={reload} className="text-sm font-medium text-primary hover:underline">
            Try again
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!loading && !alignment) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
          <Gauge className="h-7 w-7 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">No baseline yet, so there is nothing to compare against.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Alignment measures how far the requirement network has drifted from a frozen baseline. Open the Network Map to create the
            initial baseline; a Project Manager can freeze a new one there at any time.
          </p>
          <Button size="sm" variant="outline" onClick={() => navigate(`/projects/${activeProjectId}/requirements/network-map`)}>
            Open the Network Map
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center">
          {loading || !current ? (
            <Skeleton className="h-20 w-40" />
          ) : (
            <div className="flex items-center gap-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alignment Score</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground/70 hover:text-foreground" aria-label="What is the alignment score?">
                        <HelpCircle className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      How much of the requirement network is still the same as in the baseline: shared links divided by all links in either
                      network. Manual links are not counted.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className={cn("text-5xl font-bold leading-tight", status.tone)}>{current.score}%</p>
              </div>
              <div className="space-y-1.5">
                <Badge className={cn("gap-1.5 text-xs font-semibold", status.bg, status.tone, "border-transparent")}>{current.band}</Badge>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Flag className="h-3 w-3" />
                  vs. {alignment.baseline.name}, frozen {formatBaselineDate(alignment.baseline.createdAt)}
                </p>
              </div>
            </div>
          )}

          <div className="flex-1" />

          {!loading && (
            <div className="grid grid-cols-3 gap-3 sm:w-auto">
              <StatTile label="Relationship changes this week" value={breakdown.changedConnections} icon={GitCompareArrows} />
              <StatTile label="Newly connected" value={breakdown.connectionsAdded} icon={Link2} />
              <StatTile label="Disconnected" value={breakdown.connectionsRemoved} icon={Unlink} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? "Trend" : `Trend since the baseline: ${history.length} day${history.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <AlignmentTrendChart history={history} selectedDate={selectedDate} onSelectPoint={(d) => setSelectedDate(d.date)} />
              {current.changedConnections === 0 && (
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Nothing has changed since this baseline. The score moves when signals or edits add or remove requirement links.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {!loading && selectedEntry && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selectedEntry.driverSignalId ? "What drove the change" : "No driving signal recorded"}:{" "}
              {new Date(`${selectedEntry.date}T00:00:00+05:30`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {drivingSignal ? (
              <div className="space-y-3 rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ClassificationBadge classification={drivingSignal.classification} />
                  <span className="text-xs text-muted-foreground">{formatDateTime(drivingSignal.timestamp)}</span>
                </div>
                <p className="text-sm leading-relaxed text-foreground/90">"{drivingSignal.text}"</p>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="text-xs text-muted-foreground">
                    {drivingSignal.author} · {drivingSignal.channel}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => navigate(`/projects/${activeProjectId}/requirements/list?tab=signals&signal=${drivingSignal.id}`)}
                  >
                    View in Signal Feed
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {selectedEntry.driverSignalId
                  ? `Signal ${selectedEntry.driverSignalId} is not in the loaded feed.`
                  : selectedEntry.changedConnections > 0
                    ? "This day's relationship changes weren't traced to a single signal."
                    : "No relationship changes on this day."}
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              {selectedEntry.connectionsAdded} connection{selectedEntry.connectionsAdded === 1 ? "" : "s"} added,{" "}
              {selectedEntry.connectionsRemoved} removed; alignment {selectedEntry.alignmentScore}% at the end of the day.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
