import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { color, pressed as pressedTint } from './tokens';

const SIZE = 36;

/** A small round icon-button — the one deliberate exception to tokens.ts's
 * "do not round a corner anywhere" rule (readme: zero radius everywhere
 * else), asked for explicitly for the variant photo/karekod pair on the
 * Ürünler screen. Uses real vector glyphs (Ionicons, via @expo/vector-icons —
 * font-asset only, no native module) rather than emoji: an emoji glyph
 * renders differently per device skin and some Unicode symbols (e.g. the
 * "▦" tried first for karekod) don't render at all on stock Android fonts.
 *
 * Two shapes:
 *   - `imageUri` set → the photo itself, cropped to fill the circle.
 *   - `imageUri` unset → the centered glyph, with a small accent "+" badge
 *     riding the bottom-right corner when `showAddBadge` — deliberately a
 *     *sibling* of the clipped circle, not a child of it, so the badge
 *     itself is never clipped and sits outside the circle's own bounds
 *     (the karekod slot never sets this; a missing barkod is handled inside
 *     its own dialog instead). */
export function CircleIconButton({
  onPress,
  imageUri,
  icon,
  showAddBadge,
  accessibilityLabel,
}: {
  onPress: () => void;
  imageUri?: string | null;
  icon: keyof typeof Ionicons.glyphMap;
  showAddBadge?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.wrapper}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed: isPressed }) => [styles.circle, isPressed && styles.pressed]}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.image} contentFit="cover" />
        ) : (
          <Ionicons name={icon} size={17} color={color.text} />
        )}
      </Pressable>
      {showAddBadge && !imageUri && (
        <View style={styles.badge} pointerEvents="none">
          <Ionicons name="add" size={11} color={color.bg} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: SIZE, height: SIZE },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 1,
    borderColor: color.divider,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  pressed: { backgroundColor: pressedTint.onTextTint },
  image: { width: '100%', height: '100%' },
  // Absolute against `wrapper` (which does NOT clip), not `circle` (which
  // does) — this is what keeps the badge from being cut off by the photo
  // circle's own overflow:hidden, sitting right on its bottom-right edge.
  badge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: color.bg,
  },
});
