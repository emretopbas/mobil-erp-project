import { StyleSheet, Text, View } from 'react-native';

import { color, font, space } from './tokens';

/** `.nav` + `.nav-brand` — the header bar pattern. */
export function NavBar({ brand, children }: { brand: string; children?: React.ReactNode }) {
  return (
    <View style={styles.nav}>
      <Text style={styles.brand}>{brand}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderBottomWidth: 2,
    borderBottomColor: color.divider,
  },
  brand: { fontFamily: font.heading, fontSize: 18, color: color.text, marginRight: 'auto' },
});
