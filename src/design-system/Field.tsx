import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { color, font, radius } from './tokens';

/** `.field > label` — wraps an `Input` with its label. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

/** `.input` — text field on the surface color, accent focus ring. */
export function Input({ style, multiline, ...rest }: TextInputProps) {
  return (
    <TextInput
      {...rest}
      multiline={multiline}
      placeholderTextColor={color.textMuted}
      selectionColor={color.accent}
      style={[styles.input, multiline && styles.multiline, style]}
    />
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, marginBottom: 5, color: color.textMuted },
  input: {
    width: '100%',
    minHeight: 44,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontFamily: font.body,
    fontSize: 14,
    color: color.text,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.divider,
    borderRadius: radius.md,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
});
