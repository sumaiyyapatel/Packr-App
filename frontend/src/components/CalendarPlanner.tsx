import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { type as t, space, radius } from '../theme/tokens';

type Props = {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  selectedDate: string | null;
  plannedDates: Record<string, string>; // date -> outfit key
  weatherByDate?: Record<string, { max?: number; code?: number }>;
  onSelectDay: (date: string) => void;
};

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function localKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function CalendarPlanner({
  startDate,
  endDate,
  selectedDate,
  plannedDates,
  weatherByDate,
  onSelectDay,
}: Props) {
  const { c } = useTheme();

  const { year, month, weeks, title } = useMemo(() => {
    const start = new Date(`${startDate}T00:00:00`);
    const y = start.getFullYear();
    const m = start.getMonth();
    const first = new Date(y, m, 1);
    // JS getDay: 0=Sun..6=Sat. Shift so Monday=0.
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return { year: y, month: m, weeks: rows, title: `${MONTHS[m]} ${y}` };
  }, [startDate]);

  return (
    <View style={{ gap: space.md }}>
      <Text style={[t.kicker, { color: c.textTertiary }]}>{title}</Text>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d, i) => (
          <View key={i} style={styles.cellWrap}>
            <Text style={[t.micro, { color: c.textTertiary, textAlign: 'center' }]}>{d}</Text>
          </View>
        ))}
      </View>

      <View style={{ gap: space.xs }}>
        {weeks.map((week, wi) => (
          <View key={wi} style={styles.weekRow}>
            {week.map((day, di) => {
              if (day === null) return <View key={di} style={styles.cellWrap} />;
              const key = localKey(year, month, day);
              const inTrip = key >= startDate && key <= endDate;
              const planned = !!plannedDates[key];
              const selected = key === selectedDate;
              const wx = weatherByDate?.[key];
              return (
                <Pressable
                  key={di}
                  disabled={!inTrip}
                  onPress={() => onSelectDay(key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${MONTHS[month]} ${day}${planned ? ', planned' : inTrip ? ', tap to plan' : ', not in trip'}`}
                  accessibilityState={{ selected, disabled: !inTrip }}
                  style={[styles.cellWrap]}
                >
                  <View
                    style={[
                      styles.cell,
                      {
                        backgroundColor: inTrip ? c.plate : 'transparent',
                        opacity: inTrip ? 1 : 0.32,
                        borderColor: selected ? c.accent : 'transparent',
                        borderWidth: selected ? 1.5 : 0,
                      },
                    ]}
                  >
                    <Text style={[t.h2, { color: c.textPrimary }]}>{day}</Text>
                    {planned ? (
                      <View style={[styles.plannedBar, { backgroundColor: c.accent }]} />
                    ) : inTrip && wx?.max != null ? (
                      <Text style={[t.micro, { color: c.textTertiary }]}>{Math.round(wx.max)}°</Text>
                    ) : (
                      <View style={{ height: 14 }} />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  weekRow: { flexDirection: 'row' },
  cellWrap: { flex: 1, alignItems: 'center' },
  cell: {
    width: 44,
    height: 56,
    borderRadius: radius.sharp,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 6,
  },
  plannedBar: { width: 20, height: 6, borderRadius: radius.sharp },
});
