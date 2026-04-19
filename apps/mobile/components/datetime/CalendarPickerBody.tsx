import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { buildMonthGrid, compareDay, stripLocalDay, type CalendarCell } from "../../lib/calendarUtils";
import { radius, type } from "../../theme";

function chunkWeeks(cells: CalendarCell[]): CalendarCell[][] {
  const rows: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

type ThemeColors = {
  textPrimary: string;
  textSecondary: string;
  border: string;
  card: string;
  accent: string;
  bg: string;
};

type Props = {
  /** Visible month (year / month controlled internally from this initial) */
  initialMonth: Date;
  selected: Date | null;
  onSelectDay: (d: Date) => void;
  minDate?: Date;
  maxDate?: Date;
  colors: ThemeColors;
};

function isDisabled(d: Date, minDate?: Date, maxDate?: Date): boolean {
  const t = stripLocalDay(d).getTime();
  if (minDate && t < stripLocalDay(minDate).getTime()) return true;
  if (maxDate && t > stripLocalDay(maxDate).getTime()) return true;
  return false;
}

function clampMonth(y: number, m: number, min?: Date, max?: Date): { y: number; m: number } {
  let yy = y;
  let mm = m;
  if (min) {
    const tmin = new Date(min.getFullYear(), min.getMonth(), 1);
    const cur = new Date(yy, mm, 1);
    if (cur.getTime() < tmin.getTime()) {
      yy = tmin.getFullYear();
      mm = tmin.getMonth();
    }
  }
  if (max) {
    const tmax = new Date(max.getFullYear(), max.getMonth(), 1);
    const cur = new Date(yy, mm, 1);
    if (cur.getTime() > tmax.getTime()) {
      yy = tmax.getFullYear();
      mm = tmax.getMonth();
    }
  }
  return { y: yy, m: mm };
}

export function CalendarPickerBody({
  initialMonth,
  selected,
  onSelectDay,
  minDate,
  maxDate,
  colors,
}: Props) {
  const [viewY, setViewY] = useState(() => initialMonth.getFullYear());
  const [viewM, setViewM] = useState(() => initialMonth.getMonth());
  const [monthModal, setMonthModal] = useState(false);
  const [yearModal, setYearModal] = useState(false);

  const initialMonthMs = initialMonth.getTime();
  useEffect(() => {
    const d = new Date(initialMonthMs);
    setViewY(d.getFullYear());
    setViewM(d.getMonth());
  }, [initialMonthMs]);

  const { y: vy, m: vm } = useMemo(
    () => clampMonth(viewY, viewM, minDate, maxDate),
    [viewY, viewM, minDate, maxDate],
  );

  const grid = useMemo(() => buildMonthGrid(vy, vm), [vy, vm]);
  const weeks = useMemo(() => chunkWeeks(grid), [grid]);

  const yearOptions = useMemo(() => {
    const yMin = minDate ? minDate.getFullYear() : 1900;
    const yMax = maxDate ? maxDate.getFullYear() : 2100;
    const out: number[] = [];
    for (let y = yMin; y <= yMax; y++) out.push(y);
    return out;
  }, [minDate, maxDate]);

  const goPrev = useCallback(() => {
    const d = new Date(vy, vm - 1, 1);
    const c = clampMonth(d.getFullYear(), d.getMonth(), minDate, maxDate);
    setViewY(c.y);
    setViewM(c.m);
  }, [vy, vm, minDate, maxDate]);

  const goNext = useCallback(() => {
    const d = new Date(vy, vm + 1, 1);
    const c = clampMonth(d.getFullYear(), d.getMonth(), minDate, maxDate);
    setViewY(c.y);
    setViewM(c.m);
  }, [vy, vm, minDate, maxDate]);

  const canPrev = useMemo(() => {
    if (!minDate) return true;
    const cur = new Date(vy, vm, 1);
    const tmin = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    return cur.getTime() > tmin.getTime();
  }, [vy, vm, minDate]);

  const canNext = useMemo(() => {
    if (!maxDate) return true;
    const cur = new Date(vy, vm, 1);
    const tmax = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
    return cur.getTime() < tmax.getTime();
  }, [vy, vm, maxDate]);

  const today = stripLocalDay(new Date());

  const renderCell = (cell: CalendarCell, idx: number) => {
    const d = cell.date;
    const dis = isDisabled(d, minDate, maxDate);
    const isSel = selected && compareDay(d, selected) === 0;
    const isToday = compareDay(d, today) === 0;
    const label = String(d.getDate());

    return (
      <Pressable
        key={`${idx}-${d.getTime()}`}
        disabled={dis}
        onPress={() => !dis && onSelectDay(d)}
        style={[
          styles.cell,
          !cell.inCurrentMonth && styles.cellOutside,
          isSel && { backgroundColor: colors.accent },
          isToday && !isSel && { borderWidth: 1, borderColor: colors.accent },
          dis && styles.cellDisabled,
        ]}
      >
        <Text
          style={[
            styles.cellText,
            { color: cell.inCurrentMonth ? colors.textPrimary : colors.textSecondary },
            isSel && { color: "#fff", fontWeight: "700" },
            dis && { color: colors.textSecondary, opacity: 0.35 },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.wrap, { backgroundColor: colors.card }]}>
      <View style={styles.captionRow}>
        <Pressable
          onPress={goPrev}
          disabled={!canPrev}
          style={[styles.navBtn, { borderColor: colors.border }, !canPrev && { opacity: 0.35 }]}
          hitSlop={8}
        >
          <ChevronLeft size={18} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.captionCenter}>
          <Pressable onPress={() => setMonthModal(true)} style={styles.captionChip}>
            <Text style={[styles.captionText, { color: colors.textPrimary }]}>{MONTH_LABELS[vm]}</Text>
          </Pressable>
          <Pressable onPress={() => setYearModal(true)} style={styles.captionChip}>
            <Text style={[styles.captionText, { color: colors.textPrimary }]}>{vy}</Text>
          </Pressable>
        </View>
        <Pressable
          onPress={goNext}
          disabled={!canNext}
          style={[styles.navBtn, { borderColor: colors.border }, !canNext && { opacity: 0.35 }]}
          hitSlop={8}
        >
          <ChevronRight size={18} color={colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((w) => (
          <View key={w} style={styles.weekHeadCell}>
            <Text style={[styles.weekHead, { color: colors.textSecondary }]}>{w}</Text>
          </View>
        ))}
      </View>
      <View style={styles.grid}>
        {weeks.map((row, ri) => (
          <View key={`w${ri}`} style={styles.weekRow}>
            {row.map((cell, ci) => renderCell(cell, ri * 7 + ci))}
          </View>
        ))}
      </View>

      <Modal visible={monthModal} transparent animationType="fade" onRequestClose={() => setMonthModal(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setMonthModal(false)} />
          <View style={styles.modalCenter} pointerEvents="box-none">
            <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Month</Text>
          <View style={styles.monthGrid}>
            {MONTH_LABELS.map((label, mi) => {
              const firstDay = new Date(vy, mi, 1);
              const lastDay = new Date(vy, mi + 1, 0);
              const dis = Boolean(
                (minDate && stripLocalDay(lastDay) < stripLocalDay(minDate)) ||
                  (maxDate && stripLocalDay(firstDay) > stripLocalDay(maxDate)),
              );
              return (
                <Pressable
                  key={label}
                  disabled={dis}
                  onPress={() => {
                    setViewM(mi);
                    setMonthModal(false);
                  }}
                  style={[
                    styles.monthCell,
                    mi === vm && { backgroundColor: colors.accent + "33" },
                    dis && { opacity: 0.35 },
                  ]}
                >
                  <Text style={{ color: colors.textPrimary, fontSize: 13 }} numberOfLines={1}>
                    {label.slice(0, 3)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={yearModal} transparent animationType="fade" onRequestClose={() => setYearModal(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setYearModal(false)} />
          <View style={styles.modalCenter} pointerEvents="box-none">
            <View style={[styles.yearSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Year</Text>
          <ScrollView style={styles.yearScroll} keyboardShouldPersistTaps="handled">
            {yearOptions.map((y) => (
              <Pressable
                key={y}
                onPress={() => {
                  setViewY(y);
                  setYearModal(false);
                }}
                style={[styles.yearRow, y === vy && { backgroundColor: colors.accent + "33" }]}
              >
                <Text style={{ color: colors.textPrimary, fontSize: type.body.size }}>{y}</Text>
              </Pressable>
            ))}
          </ScrollView>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderRadius: radius.md,
  },
  captionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  captionCenter: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  captionChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  captionText: {
    fontSize: 16,
    fontWeight: "700",
  },
  weekRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  weekHeadCell: {
    flex: 1,
    alignItems: "center",
  },
  weekHead: {
    textAlign: "center",
    fontSize: 12,
    paddingVertical: 4,
  },
  grid: {},
  cell: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  cellOutside: { opacity: 0.55 },
  cellDisabled: {},
  cellText: {
    fontSize: 14,
  },
  modalRoot: {
    flex: 1,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalCenter: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  monthCell: {
    width: "22%",
    paddingVertical: 10,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  yearSheet: {
    maxHeight: 360,
    alignSelf: "center",
    width: "100%",
    maxWidth: 320,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  yearScroll: { maxHeight: 280 },
  yearRow: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
  },
});
