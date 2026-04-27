"use client";

import * as React from "react";
import { Calendar as CalendarIcon } from "lucide-react";

import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../ui/utils";
import { PickerDropdownCard, pickerPopoverContentClassName } from "./PickerDropdownCard";
import {
  CALENDAR_FROM_FALLBACK,
  CALENDAR_TO_FALLBACK,
  stripLocalDay,
} from "./calendarConstraints";
import { formatDateLong, parseIsoDateOnly, toIsoDateOnly } from "./dateTimeFormat";

export type DatePickerFieldProps = {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Outer wrapper */
  className?: string;
  /** Merged into trigger button */
  triggerClassName?: string;
  /** Inclusive min calendar day */
  minDate?: Date;
  /** Inclusive max calendar day */
  maxDate?: Date;
};

export function DatePickerField({
  value,
  onChange,
  id,
  disabled,
  placeholder = "Select date",
  className,
  triggerClassName,
  minDate,
  maxDate,
}: DatePickerFieldProps) {
  const selected = parseIsoDateOnly(value);
  const [open, setOpen] = React.useState(false);

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
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>
              {selected ? formatDateLong(selected) : placeholder}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(pickerPopoverContentClassName, "w-auto")}
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <PickerDropdownCard>
            <Calendar
              mode="single"
              captionLayout="dropdown-buttons"
              fromDate={fromDate}
              toDate={toDate}
              fromYear={fromDate.getFullYear()}
              toYear={toDate.getFullYear()}
              selected={selected}
              disabled={disabledMatcher}
              onSelect={(d) => {
                if (d) {
                  onChange(toIsoDateOnly(d));
                  setOpen(false);
                }
              }}
            />
          </PickerDropdownCard>
        </PopoverContent>
      </Popover>
    </div>
  );
}
