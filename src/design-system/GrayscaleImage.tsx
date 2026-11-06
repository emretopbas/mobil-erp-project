import { Image, type ImageProps } from 'react-native';

/**
 * `.grayscale` — "every content photograph goes through it," prints in pure
 * black and white (`filter: grayscale(1) contrast(1.08)`).
 *
 * ⚠️ LIMITATION: React Native has no built-in CSS-filter equivalent, so this
 * cannot truly desaturate a photo without a native image-processing
 * dependency (e.g. a Skia or GL-based library) that hasn't been added to
 * this project yet. This component is a placeholder that renders the image
 * unmodified so call sites match the design system's naming/usage now;
 * revisit it — pick and add a real filtering library — before the app ships
 * its first actual photograph. It is a no-op today by design, not a bug.
 */
export function GrayscaleImage(props: ImageProps) {
  return <Image {...props} />;
}
