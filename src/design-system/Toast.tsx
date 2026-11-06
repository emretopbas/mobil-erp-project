import { useEffect } from 'react';
import { Animated, StyleSheet, Text, useAnimatedValue } from 'react-native';

import { color, font } from './tokens';

/** Transient bottom banner — ported from queue-erp's Toast.tsx. Deliberately
 * an inverted-contrast chip (dark fill, light text) regardless of the app's
 * base theme — that's how it read in the original dark mockup too (an
 * `ink`-filled chip on the `ground` screen), so the light port keeps the
 * same "pops in high contrast" role rather than just recoloring flatly.
 * Uses RN's `useAnimatedValue()` rather than the old `useRef(new
 * Animated.Value(...)).current` idiom the original mockup used — same
 * result, but doesn't trip the React Compiler's ref-access-during-render
 * lint (`react-hooks/refs`), which the old idiom does even though it's
 * otherwise a completely standard, safe pattern. */
export function Toast({ message }: { message: string }) {
  const opacity = useAnimatedValue(0);
  const translateY = useAnimatedValue(8);

  useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    translateY.setValue(8);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [message, opacity, translateY]);

  if (!message) return null;

  return (
    <Animated.View style={[styles.toast, { opacity, transform: [{ translateY }] }]} pointerEvents="none">
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 96,
    padding: 13,
    backgroundColor: color.text,
    zIndex: 70,
  },
  text: { color: color.bg, fontSize: 13, fontFamily: font.bodyBold },
});
