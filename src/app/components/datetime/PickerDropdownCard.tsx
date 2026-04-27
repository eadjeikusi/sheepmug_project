"use client";

import * as React from "react";

import { cn } from "../ui/utils";

/**
 * Radix `PopoverContent` default styles are reset on pickers, and the visible “dropdown”
 * is this card so all date/time panels share a consistent elevated card UI.
 */
export const pickerPopoverContentClassName = cn(
  "z-[200] w-auto min-w-0 max-w-[min(100vw-1rem,56rem)] border-0 bg-transparent p-0",
  "shadow-none outline-none",
  "data-[state=open]:border-0 data-[state=open]:shadow-none",
);

export function PickerDropdownCard({
  className,
  children,
  ...rest
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="picker-dropdown-card"
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-lg",
        "ring-1 ring-border/20 dark:ring-border/50",
        "overflow-hidden",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
