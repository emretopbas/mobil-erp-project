import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius } from './tokens';

interface Option {
  label: string;
  value: string;
}

/** `.seg` + `.seg-opt`. */
export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.seg}>
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.opt,
              i > 0 && styles.optBorder,
              selected ? styles.optSelected : undefined,
            ]}>
            <Text style={[styles.label, selected && styles.labelSelected]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  seg: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.divider,
    borderRadius: radius.md,
  },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  optBorder: { borderLeftWidth: 1, borderLeftColor: color.divider },
  optSelected: { backgroundColor: color.accent },
  label: { fontSize: 13, color: color.text },
  labelSelected: { color: color.bg },
});
