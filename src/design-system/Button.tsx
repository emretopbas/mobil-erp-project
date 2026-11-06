import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { color, disabledOpacity, font, pressed, radius, space } from './tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** `.btn-block` — full width, flush-left content instead of centered. */
  block?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** `.btn` + `.btn-primary/-secondary/-ghost/-icon/-block`. Labels stay flush
 * left in block mode ("a button wider than its label starts the text at the
 * left padding edge, never centered") — the base button stays centered. */
export function Button({ label, onPress, variant = 'secondary', block, disabled, icon, style }: ButtonProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed: isPressed }) => [
        styles.base,
        block && styles.block,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        variant === 'icon' && styles.icon,
        disabled && { opacity: disabledOpacity },
        isPressed && !disabled && pressedStyle(variant),
        style,
      ]}>
      {icon}
      {variant !== 'icon' && (
        <Text
          style={[
            styles.label,
            variant === 'primary' && styles.labelOnAccent,
            variant === 'ghost' && styles.labelAccent,
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function pressedStyle(variant: ButtonVariant): ViewStyle {
  switch (variant) {
    case 'primary':
      return { backgroundColor: pressed.accentFillDeeper };
    case 'secondary':
    case 'icon':
      return { backgroundColor: pressed.onTextTint };
    case 'ghost':
      return { backgroundColor: pressed.onAccentTint };
  }
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44, // touch target floor; CSS min-height was 36 (desktop)
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.md,
    paddingVertical: space[2],
    paddingHorizontal: space[3] * 1.2,
    backgroundColor: 'transparent',
  },
  block: {
    width: '100%',
    marginTop: space[2],
    justifyContent: 'flex-start',
  },
  primary: { backgroundColor: color.accent },
  secondary: { borderColor: color.divider },
  ghost: { paddingHorizontal: space[1] },
  icon: { width: 44, height: 44, padding: 0 },
  label: { fontFamily: font.heading, fontSize: 14, color: color.text },
  labelOnAccent: { color: color.bg },
  labelAccent: { color: color.accent },
});
