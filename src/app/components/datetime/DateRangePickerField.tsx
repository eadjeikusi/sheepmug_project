"use client";

import * as React from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { PickerDropdownCard, pickerPopoverContentClassName } from "./PickerDropdownCard";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../ui/utils";
import { CALENDAR_FROM_FALLBACK, CALENDAR_TO_FALLBACK } from "./calendarConstraints";
import {
  computePresetRange,
  matchPresetId,
  presetsWithinSpan,
  type PresetId,
} from "./dateRangePresets";
import { formatDateLong, inclusiveLocalDayCount, parseIsoDateOnly, toIsoDateOnly } from "./dateTimeFormat";

export type DateRangePickerFieldProps = {
  start: string;
  end: string;
  onChange: (r: { start: string; end: string }) => void;
  id?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  minSpanDays?: number;
  maxSpanDays?: number;
  showPresets?: boolean;
};

function toRangeState(start: string, end: string): DateRange | undefined {
  const f = parseIsoDateOnly(start);
  const t = parseIsoDateOnly(end);
  if (!f || !t) return undefined;
  return { from: f, to: t };
}

const DEFAULT_MAX = 366 * 3;

export function DateRangePickerField({
  start,
  end,
  onChange,
  id,
  className,
  triggerClassName,
  disabled,
  minSpanDays = 1,
  maxSpanDays = DEFAULT_MAX,
  showPresets = true,
}: DateRangePickerFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [calRange, setCalRange] = React.useState<DateRange | undefined>(() => toRangeState(start, end));
  const [activePreset, setActivePreset] = React.useState<PresetId | "custom">("custom");
  const [displayMonth, setDisplayMonth] = React.useState(() => {
    const t = parseIsoDateOnly(end) || parseIsoDateOnly(start) || new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [error, setError] = React.useState<string | null>(null);
  const commitSnapshot = React.useRef({ start, end });

  React.useEffect(() => {
    if (!open) {
      setCalRange(toRangeState(start, end));
    }
  }, [start, end, open]);

  const selected = toRangeState(start, end);
  const label =
    selected?.from && selected?.to
      ? `${formatDateLong(selected.from)} – ${formatDateLong(selected.to)}`
      : "Select date range";

  const presetList = React.useMemo(
    () => presetsWithinSpan(minSpanDays, maxSpanDays),
    [minSpanDays, maxSpanDays],
  );

  const applyYmdPreset = (next: { start: string; end: string }, preset?: PresetId | "custom") => {
    const a = parseIsoDateOnly(next.start);
    const b = parseIsoDateOnly(next.end);
    if (a && b) {
      setCalRange({ from: a, to: b });
      if (preset !== undefined) setActivePreset(preset);
      setDisplayMonth(new Date(a.getFullYear(), a.getMonth(), 1));
    }
  };

  const handleApply = () => {
    setError(null);
    const from = calRange?.from;
    let to = calRange?.to;
    if (from && !to) to = from;
    if (!from || !to) {
      setError("Select a start and end date.");
      return;
    }
    const startY = toIsoDateOnly(from);
    const endY = toIsoDateOnly(to);
    const span = inclusiveLocalDayCount(startY, endY);
    if (span < minSpanDays || span > maxSpanDays) {
      setError(`Date range must be between ${minSpanDays} and ${maxSpanDays} days inclusive.`);
      return;
    }
    onChange({ start: startY, end: endY });
    setOpen(false);
  };

  const handleCancel = () => {
    setCalRange(toRangeState(commitSnapshot.current.start, commitSnapshot.current.end));
    setError(null);
    setActivePreset(
      matchPresetId(commitSnapshot.current.start, commitSnapshot.current.end),
    );
    setOpen(false);
  };

  const fromLabel = calRange?.from;
  const toLabel = calRange?.to;

  return (
    <div className={cn("w-full", className)}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          if (o) {
            commitSnapshot.current = { start, end };
            setCalRange(toRangeState(start, end));
            setActivePreset(matchPresetId(start, end));
            setError(null);
            const t = parseIsoDateOnly(start) || parseIsoDateOnly(end) || new Date();
            setDisplayMonth(new Date(t.getFullYear(), t.getMonth(), 1));
          } else {
            setError(null);
          }
          setOpen(o);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            className={cn(
              "flex h-9 w-full min-w-0 items-center justify-start gap-2 rounded-md border border-input bg-input-background px-3 py-1 text-left text-sm shadow-xs transition-[color,box-shadow] outline-none",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
              triggerClassName,
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn("min-w-0 truncate", !selected?.from && "text-muted-foreground")}>{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(
            pickerPopoverContentClassName,
            "w-[min(100vw-1rem,44rem)]",
          )}
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <PickerDropdownCard className="flex max-h-[min(90vh,36rem)] flex-col sm:max-h-[32rem] sm:flex-row">
            {showPresets && presetList.length > 0 ? (
              <ScrollArea className="max-h-40 w-full min-w-0 sm:max-h-none sm:min-w-[9.5rem] sm:max-w-[10rem] sm:border-r">
                <div className="flex flex-col gap-0.5 p-2 pr-1">
                  {presetList.map((p) => {
                    const active = activePreset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          const r = computePresetRange(p.id);
                          applyYmdPreset(r, p.id);
                        }}
                        className={cn(
                          "w-full rounded-md px-2.5 py-2 text-left text-sm",
                          active
                            ? "bg-accent font-medium text-accent-foreground"
                            : "text-foreground hover:bg-muted/80",
                        )}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setActivePreset("custom")}
                    className={cn(
                      "w-full rounded-md px-2.5 py-2 text-left text-sm",
                      activePreset === "custom"
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-foreground hover:bg-muted/80",
                    )}
                  >
                    Custom
                  </button>
                </div>
              </ScrollArea>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col border-t sm:border-t-0">
              <div className="overflow-x-auto p-0">
                <Calendar
                  mode="range"
                  captionLayout="dropdown-buttons"
                  fromDate={CALENDAR_FROM_FALLBACK}
                  toDate={CALENDAR_TO_FALLBACK}
                  fromYear={CALENDAR_FROM_FALLBACK.getFullYear()}
                  toYear={CALENDAR_TO_FALLBACK.getFullYear()}
                  numberOfMonths={2}
                  month={displayMonth}
                  onMonthChange={setDisplayMonth}
                  selected={calRange}
                  onSelect={(r) => {
                    setActivePreset("custom");
                    setCalRange(r);
                  }}
                />
              </div>
              <div className="space-y-2 border-t px-3 py-2.5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="flex min-w-0 flex-col gap-1.5 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="w-8 shrink-0 text-muted-foreground">Start</span>
                      <span className="inline-flex min-w-0 max-w-full flex-1 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground sm:flex-initial">
                        {fromLabel ? formatDateLong(fromLabel) : "—"}
                        {toLabel && fromLabel ? (
                          <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label="Use end date for start"
                            onClick={() => {
                              if (toLabel) setCalRange({ from: toLabel, to: toLabel });
                              setActivePreset("custom");
                            }}
                          >
                            <X className="size-3.5" />
                          </button>
                        ) : null}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="w-8 shrink-0 text-muted-foreground">End</span>
                      <span className="inline-flex min-w-0 max-w-full flex-1 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground sm:flex-initial">
                        {toLabel ? formatDateLong(toLabel) : "—"}
                        {toLabel && fromLabel ? (
                          <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label="Use start date for end"
                            onClick={() => {
                              if (fromLabel) setCalRange({ from: fromLabel, to: fromLabel });
                              setActivePreset("custom");
                            }}
                          >
                            <X className="size-3.5" />
                          </button>
                        ) : null}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 justify-end gap-2 sm:pl-1">
                    <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
                      Cancel
                    </Button>
                    <Button type="button" size="sm" onClick={handleApply}>
                      Apply
                    </Button>
                  </div>
                </div>
                {error ? <p className="text-xs text-destructive">{error}</p> : null}
              </div>
            </div>
          </PickerDropdownCard>
        </PopoverContent>
      </Popover>
    </div>
  );
}
