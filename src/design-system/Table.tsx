import { StyleSheet, Text, View } from 'react-native';

import { color, space } from './tokens';

export interface TableColumn<T> {
  key: string;
  label: string;
  width?: number; // flex weight; omit to share remaining space equally
  render: (row: T) => string;
}

/** `.table` — no native table element on RN; built from flex rows. Themed
 * header + row rules, same as the CSS version (no `tbody tr:hover` — that's
 * a desktop-only affordance with no touch equivalent). */
export function Table<T>({ columns, rows, keyExtractor }: {
  columns: TableColumn<T>[];
  rows: T[];
  keyExtractor: (row: T, index: number) => string;
}) {
  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.headRow]}>
        {columns.map((c) => (
          <Text key={c.key} style={[styles.th, { flex: c.width ?? 1 }]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((row, i) => (
        <View key={keyExtractor(row, i)} style={styles.row}>
          {columns.map((c) => (
            <Text key={c.key} style={[styles.td, { flex: c.width ?? 1 }]}>
              {c.render(row)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  table: { width: '100%' },
  row: { flexDirection: 'row' },
  headRow: { borderBottomWidth: 2, borderBottomColor: color.divider },
  th: {
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: color.textMuted,
    padding: space[2],
  },
  td: {
    fontSize: 14,
    color: color.text,
    padding: space[2],
    borderBottomWidth: 1,
    borderBottomColor: color.divider,
  },
});
