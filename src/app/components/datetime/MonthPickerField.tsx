"use client";

import * as React from "react";
import { CalendarRange } from "lucide-react";

import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../ui/utils";
import { PickerDropdownCard, pickerPopoverContentClassName } from "./PickerDropdownCard";
import { CALENDAR_FROM_FALLBACK, CALENDAR_TO_FALLBACK } from "./calendarConstraints";
import { formatMonthYear, parseYearMonth, toYearMonthString } from "./dateTimeFormat";

export type MonthPickerFieldProps = {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
};

export function MonthPickerField({
  value,
  onChange,
  id,
  disabled,
  placeholder = "Select month",
  className,
  triggerClassName,
}: MonthPickerFieldProps) {
  const selected = parseYearMonth(value);
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState<Date>(() => selected ?? new Date());

  React.useEffect(() => {
    const s = parseYearMonth(value);
    if (s) setMonth(s);
  }, [value]);

  return (
    <div className={cn("w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            className={cn(
              "flex h-9 w-full min-w-0 items-center justify-start gap-2 rounded-md border border-input bg-input-background px-3 py-1 text-left text-sm shadow-xs outline-none",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
              triggerClassName,
            )}
          >
            <CalendarRange className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>
              {selected ? formatMonthYear(selected) : placeholder}
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
              fromDate={CALENDAR_FROM_FALLBACK}
              toDate={CALENDAR_TO_FALLBACK}
              fromYear={CALENDAR_FROM_FALLBACK.getFullYear()}
              toYear={CALENDAR_TO_FALLBACK.getFullYear()}
              month={month}
              onMonthChange={setMonth}
              selected={selected}
              onSelect={(d) => {
                if (d) {
                  onChange(toYearMonthString(d));
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
