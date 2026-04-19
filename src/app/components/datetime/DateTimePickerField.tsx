"use client";

import * as React from "react";
import { Calendar as CalendarIcon, Clock } from "lucide-react";

import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../ui/utils";
import {
  CALENDAR_FROM_FALLBACK,
  CALENDAR_TO_FALLBACK,
  stripLocalDay,
} from "./calendarConstraints";
import {
  formatDateCompactPicker,
  formatDateLong,
  formatTime12h,
  parseDateTimeLocalValue,
  toDateTimeLocalString,
} from "./dateTimeFormat";
import { hhmmToParts, partsToHHmm } from "./timeParts";

export type DateTimePickerFieldProps = {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  disabled?: boolean;
  datePlaceholder?: string;
  timePlaceholder?: string;
  className?: string;
  /** Split control outer border */
  splitClassName?: string;
  /** Left / right trigger segments */
  triggerClassName?: string;
  /** Inclusive min calendar day (date portion) */
  minDate?: Date;
  /** Inclusive max calendar day (date portion) */
  maxDate?: Date;
};

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

export function DateTimePickerField({
  value,
  onChange,
  id,
  disabled,
  datePlaceholder = "Date",
  timePlaceholder = "Time",
  className,
  splitClassName,
  triggerClassName,
  minDate,
  maxDate,
}: DateTimePickerFieldProps) {
  const parsed = parseDateTimeLocalValue(value);
  const dateObj = parsed?.date;
  const timeHHmm = parsed?.timeHHmm ?? "";

  const [openDate, setOpenDate] = React.useState(false);
  const [openTime, setOpenTime] = React.useState(false);

  const fromDate = minDate ?? CALENDAR_FROM_FALLBACK;
  const toDate = maxDate ?? CALENDAR_TO_FALLBACK;

  const disabledMatcher = React.useCallback(
    (date: Date) => {
      const t = stripLocalDay(date);
      if (minDate && t.getTime() < stripLocalDay(minDate).getTime()) return true;
      if (maxDate && t.getTime() > stripLocalDay(maxDate).getTime()) return true;
      return false;
    },
    [minDate, maxDate],
  );

  const setDate = (d: Date) => {
    const t = timeHHmm || "00:00";
    onChange(toDateTimeLocalString(d, t));
  };

  const { hour12, minute, isPm } = hhmmToParts(timeHHmm || "00:00");

  const setTimeParts = (next: { hour12?: number; minute?: number; isPm?: boolean }) => {
    const h = next.hour12 ?? hour12;
    const mi = next.minute ?? minute;
    const ap = next.isPm ?? isPm;
    const hhmm = partsToHHmm(h, mi, ap);
    const base = dateObj ?? new Date();
    onChange(toDateTimeLocalString(base, hhmm));
  };

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "flex w-full min-w-0 rounded-md border border-input bg-input-background shadow-xs",
          splitClassName,
        )}
      >
        <Popover open={openDate} onOpenChange={setOpenDate}>
          <PopoverTrigger asChild>
            <button
              type="button"
              id={id ? `${id}-date` : undefined}
              disabled={disabled}
              className={cn(
                "flex min-h-9 min-w-[min(100%,14rem)] flex-[2] items-center justify-start gap-2 px-3 py-2 text-left text-sm outline-none transition-[color,box-shadow]",
                "focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
                triggerClassName,
              )}
            >
              <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span
                className={cn(
                  "min-w-0 flex-1 text-left leading-snug whitespace-nowrap",
                  !dateObj && "text-muted-foreground",
                )}
                title={dateObj ? formatDateLong(dateObj) : undefined}
              >
                {dateObj ? formatDateCompactPicker(dateObj) : datePlaceholder}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="z-[130] w-auto border p-0 shadow-md" align="start">
            <Calendar
              mode="single"
              captionLayout="dropdown-buttons"
              fromDate={fromDate}
              toDate={toDate}
              fromYear={fromDate.getFullYear()}
              toYear={toDate.getFullYear()}
              selected={dateObj}
              disabled={disabledMatcher}
              onSelect={(d) => {
                if (d) {
                  setDate(d);
                  setOpenDate(false);
                }
              }}
            />
          </PopoverContent>
        </Popover>

        <div className="w-px shrink-0 self-stretch bg-border" aria-hidden />

        <Popover open={openTime} onOpenChange={setOpenTime}>
          <PopoverTrigger asChild>
            <button
              type="button"
              id={id ? `${id}-time` : undefined}
              disabled={disabled}
              className={cn(
                "flex min-h-9 w-[8.5rem] shrink-0 items-center justify-start gap-2 px-2.5 py-2 text-left text-sm outline-none transition-[color,box-shadow] sm:w-[9rem]",
                "focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
                triggerClassName,
              )}
            >
              <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className={cn("min-w-0 whitespace-nowrap tabular-nums", !timeHHmm && "text-muted-foreground")}>
                {timeHHmm ? formatTime12h(timeHHmm) : timePlaceholder}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="z-[130] w-auto p-3" align="start">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
                value={hour12}
                onChange={(e) => setTimeParts({ hour12: parseInt(e.target.value, 10) })}
                aria-label="Hour"
              >
                {HOURS_12.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">:</span>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
                value={minute}
                onChange={(e) => setTimeParts({ minute: parseInt(e.target.value, 10) })}
                aria-label="Minute"
              >
                {MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
                value={isPm ? "pm" : "am"}
                onChange={(e) => setTimeParts({ isPm: e.target.value === "pm" })}
                aria-label="AM or PM"
              >
                <option value="am">AM</option>
                <option value="pm">PM</option>
              </select>
              <button
                type="button"
                className="ml-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs font-medium shadow-xs hover:bg-accent"
                onClick={() => setOpenTime(false)}
              >
                Done
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
