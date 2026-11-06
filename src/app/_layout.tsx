import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
  useFonts,
} from '@expo-google-fonts/archivo';
import { DarkTheme, DefaultTheme, Slot, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { SessionProvider, useSession } from '@/services/SessionProvider';

SplashScreen.preventAutoHideAsync();

/** Redirects based on session status (CLAUDE.md §3's auth flow) and holds
 * rendering until the Archivo weights `design-system/tokens.ts` names
 * (`font.heading`/`body`/`bodySemiBold`) are loaded — without this gate,
 * every Heading/BodyText in the app would silently render in the platform
 * default font (RN drops an unrecognized fontFamily with no warning; there
 * was no visible sign anything was missing). Renders nothing while
 * `loading` or fonts aren't ready — the routed tree (and therefore the
 * authenticated home, the queue shell) never mounts until both are known,
 * so there's no flash of unstyled or unauthenticated content. The splash
 * overlay covers this same window from on top, at the root. */
function AuthGate({ children, fontsReady }: { children: ReactNode; fontsReady: boolean }) {
  const { status } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading' || !fontsReady) return;
    const top = segments[0] as string | undefined;
    const inSignIn = top === 'sign-in';
    const inCreateBusiness = top === 'create-business';

    if (status === 'signed_out' && !inSignIn) {
      router.replace('/sign-in');
    } else if (status === 'needs_business' && !inCreateBusiness) {
      router.replace('/create-business');
    } else if (status === 'ready' && (inSignIn || inCreateBusiness)) {
      router.replace('/');
    }
  }, [status, fontsReady, segments, router]);

  if (status === 'loading' || !fontsReady) return null;
  return <>{children}</>;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
    Archivo_900Black,
  });
  // A load failure (rare — bad network on first install, etc.) shouldn't
  // freeze the splash screen forever; fall back to the platform font rather
  // than blocking the app from ever opening.
  const fontsReady = fontsLoaded || !!fontError;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SessionProvider>
        <AuthGate fontsReady={fontsReady}>
          <Slot />
        </AuthGate>
        <AnimatedSplashOverlay />
      </SessionProvider>
    </ThemeProvider>
  );
}
