"use client";

import * as React from "react";
import { Clock } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../ui/utils";
import { formatTime12h } from "./dateTimeFormat";
import { hhmmToParts, partsToHHmm } from "./timeParts";

export type TimePickerFieldProps = {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  /** Use 24h on trigger instead of 12h */
  use24hDisplay?: boolean;
};

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

export function TimePickerField({
  value,
  onChange,
  id,
  disabled,
  placeholder = "Select time",
  className,
  triggerClassName,
  use24hDisplay = false,
}: TimePickerFieldProps) {
  const t = value.trim();
  const [open, setOpen] = React.useState(false);
  const display = !t ? "" : use24hDisplay ? t : formatTime12h(t);

  const { hour12, minute, isPm } = hhmmToParts(t || "00:00");

  const apply = (next: { hour12?: number; minute?: number; isPm?: boolean }) => {
    const h = next.hour12 ?? hour12;
    const mi = next.minute ?? minute;
    const ap = next.isPm ?? isPm;
    onChange(partsToHHmm(h, mi, ap));
  };

  return (
    <div className={cn("w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
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
            <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn("min-w-0 truncate", !t && "text-muted-foreground")}>
              {t ? display : placeholder}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={id ? `${id}-hour` : undefined}>
              Hour
            </label>
            <select
              id={id ? `${id}-hour` : undefined}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
              value={hour12}
              onChange={(e) => apply({ hour12: parseInt(e.target.value, 10) })}
            >
              {HOURS_12.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">:</span>
            <label className="sr-only" htmlFor={id ? `${id}-min` : undefined}>
              Minute
            </label>
            <select
              id={id ? `${id}-min` : undefined}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
              value={minute}
              onChange={(e) => apply({ minute: parseInt(e.target.value, 10) })}
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, "0")}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor={id ? `${id}-ap` : undefined}>
              AM or PM
            </label>
            <select
              id={id ? `${id}-ap` : undefined}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
              value={isPm ? "pm" : "am"}
              onChange={(e) => apply({ isPm: e.target.value === "pm" })}
            >
              <option value="am">AM</option>
              <option value="pm">PM</option>
            </select>
            <button
              type="button"
              className="ml-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs font-medium shadow-xs hover:bg-accent"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
