import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font, space } from './tokens';

const WEEKDAY_LABELS = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
const MONTH_LABELS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Monday-first day-of-week index (RN's `getDay()` is Sunday-first). */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** A compact month-grid calendar — no native dependency, so it needs no
 * device rebuild to ship or change. Replaces free-text "Tarih (YYYY-MM-DD)"
 * inputs (e.g. tasks.tsx's Mesai form) with an actual date picker. Renders
 * the month containing `value`; tapping a day calls `onChange` with a Date
 * at local midnight on that day (callers combine it with a separately
 * picked hour). */
export function DatePicker({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const [viewedMonth, setViewedMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));

  const year = viewedMonth.getFullYear();
  const month = viewedMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = mondayIndex(firstOfMonth);
  const today = new Date();

  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const shiftMonth = (delta: number) => setViewedMonth(new Date(year, month + delta, 1));

  return (
    <View>
      <View style={styles.header}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={8} style={styles.navBtn}>
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>{MONTH_LABELS[month]} {year}</Text>
        <Pressable onPress={() => shiftMonth(1)} hitSlop={8} style={styles.navBtn}>
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((w) => (
          <Text key={w} style={styles.weekdayLabel}>{w}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={i} style={styles.cell} />;
          const cellDate = new Date(year, month, day);
          const isSelected = sameDay(cellDate, value);
          const isToday = sameDay(cellDate, today);
          return (
            <Pressable key={i} onPress={() => onChange(cellDate)} style={styles.cell}>
              <View style={[styles.dayCircle, isSelected && styles.dayCircleSelected, !isSelected && isToday && styles.dayCircleToday]}>
                <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>{day}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const CELL_SIZE = 40;

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: space[2] },
  navBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: color.text },
  navText: { fontSize: 16, fontFamily: font.heading, color: color.text },
  monthLabel: { fontSize: 14, fontFamily: font.heading, color: color.text },
  weekRow: { flexDirection: 'row', width: CELL_SIZE * 7 },
  weekdayLabel: { width: CELL_SIZE, textAlign: 'center', fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: color.dim },
  // `flexWrap: 'wrap'` only breaks a row at exactly 7 cells if the
  // container is exactly 7 cells wide — without an explicit width this
  // View stretches to whatever its parent (Field/Dialog/form) happens to
  // be, and once 8+ cells fit per row the grid wraps mid-week instead of
  // at Sunday, drifting every date left by however many extra columns
  // fit. Pinning the width to exactly 7 cells is what keeps every row a
  // real Monday–Sunday week aligned under `weekRow`'s labels.
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: CELL_SIZE * 7 },
  cell: { width: CELL_SIZE, height: CELL_SIZE, alignItems: 'center', justifyContent: 'center' },
  dayCircle: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  dayCircleSelected: { backgroundColor: color.accent },
  dayCircleToday: { borderWidth: 1, borderColor: color.accent },
  dayText: { fontSize: 13, color: color.text },
  dayTextSelected: { color: color.bg, fontWeight: '700' },
});
