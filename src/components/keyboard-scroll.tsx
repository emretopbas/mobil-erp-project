import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Platform, TextInput, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from 'react-native';

// Android'de klavye içeriği örtüyor (pencere küçülmüyor) — kabuğun ScrollView'ı
// sadece alt boşluk (paddingBottom) ekliyordu, odaktaki alanı görünür yere
// KAYDIRMIYORDU. Adet matrisinde alttaki bir hücreye dokununca hücre klavyenin
// arkasında kalıyordu. Bu kanca: klavye yüksekliğini izler ve odaktaki
// TextInput klavyenin üstünde değilse ScrollView'ı o kadar kaydırır.

type Scroller = { ensureVisible: () => void };
const KeyboardScrollContext = createContext<Scroller | null>(null);

/** Odaktaki alanı klavyenin üstüne kaydırır (sağlayıcı yoksa no-op). */
export function useEnsureFocusedVisible(): () => void {
  const ctx = useContext(KeyboardScrollContext);
  return ctx?.ensureVisible ?? noop;
}

const noop = () => {};

/** Ekran (ScrollView sahibi) için: `scrollRef`/`onScroll`'u ScrollView'a bağla,
 * `keyboardHeight`'ı içerik alt boşluğuna ekle, `KeyboardScrollProvider` ile alt bileşenleri sar. */
export function useKeyboardScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const ensureVisible = useCallback(() => {
    if (Platform.OS !== 'android' || keyboardTop.current === null) return;
    const input = TextInput.State.currentlyFocusedInput?.();
    if (!input) return;
    // Odaktaki alanın altında ~2 satır daha görünsün diye geniş pay.
    const limit = keyboardTop.current - 110;
    input.measureInWindow((_x, y, _w, h) => {
      const bottom = y + h;
      let dy = 0;
      if (bottom > limit) dy = bottom - limit;
      else if (y < 140) dy = y - 140;
      if (dy !== 0) scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current + dy), animated: true });
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(ensureVisible, 80);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [ensureVisible]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  const scroller = useMemo<Scroller>(() => ({ ensureVisible }), [ensureVisible]);

  return { scrollRef, onScroll, keyboardHeight, scroller };
}

export function KeyboardScrollProvider({ scroller, children }: { scroller: Scroller; children: ReactNode }) {
  return <KeyboardScrollContext.Provider value={scroller}>{children}</KeyboardScrollContext.Provider>;
}
