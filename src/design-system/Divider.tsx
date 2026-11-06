import { StyleSheet, View, type ViewStyle } from 'react-native';

import { color, space } from './tokens';

/** `.hr` — a strong 2px rule. "Do not soften the rules into hairlines." */
export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[styles.hr, style]} />;
}

const styles = StyleSheet.create({
  hr: {
    height: 2,
    marginVertical: space[4],
    backgroundColor: color.divider,
  },
});
