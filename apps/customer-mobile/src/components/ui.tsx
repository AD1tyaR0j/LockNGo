import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type RefreshControlProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Brand: indigo primary + saffron highlight. All text pairs checked against WCAG AA. */
const light = {
  bg: '#f5f6fb',
  surface: '#ffffff',
  border: '#dfe2ee',
  text: '#141629',
  muted: '#5a6079',
  accent: '#4f46e5',
  accentSoft: '#eef0ff',
  accentText: '#ffffff',
  highlight: '#b45309',
  highlightBg: '#fff4e0',
  heroBg: '#4338ca',
  heroText: '#ffffff',
  heroMuted: '#c7d2fe',
  saffron: '#fbbf24',
  saffronText: '#1a1300',
  danger: '#c0263f',
  dangerBg: '#fde8ec',
  warnBg: '#fef3dd',
  warn: '#9a5800',
  okBg: '#e3f8ef',
  ok: '#047857',
  simBg: '#fbe8fd',
  sim: '#a21caf',
  shadow: '0px 2px 10px rgba(20, 22, 41, 0.07)',
};
const dark: typeof light = {
  bg: '#0d0f1c',
  surface: '#161931',
  border: '#2b2f52',
  text: '#e9eaf5',
  muted: '#9da2c2',
  accent: '#8b85ff',
  accentSoft: '#23264a',
  accentText: '#0d0f1c',
  highlight: '#fbbf5a',
  highlightBg: '#3a2a0c',
  heroBg: '#3730a3',
  heroText: '#ffffff',
  heroMuted: '#c7d2fe',
  saffron: '#fbbf24',
  saffronText: '#1a1300',
  danger: '#ff8095',
  dangerBg: '#3e1520',
  warnBg: '#3a2a0c',
  warn: '#fbbf5a',
  okBg: '#12301f',
  ok: '#4ade9b',
  simBg: '#3a1640',
  sim: '#eb8cf5',
  shadow: '0px 1px 2px rgba(0, 0, 0, 0.4)',
};
export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

export function Screen({
  children,
  refreshControl,
}: {
  children: ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['bottom', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.screen}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.surface, borderColor: t.border, boxShadow: t.shadow },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function H1({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text style={[styles.h1, { color: t.text }]} accessibilityRole="header">
      {children}
    </Text>
  );
}
export function H2({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text style={[styles.h2, { color: t.text }]} accessibilityRole="header">
      {children}
    </Text>
  );
}
export function P({
  children,
  muted,
  style,
  testID,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: object;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Text
      testID={testID}
      style={[{ color: muted ? t.muted : t.text, fontSize: 15, lineHeight: 21 }, style]}
    >
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'highlight';
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.accent : variant === 'highlight' ? t.saffron : t.surface;
  const fg =
    variant === 'primary'
      ? t.accentText
      : variant === 'highlight'
        ? t.saffronText
        : variant === 'danger'
          ? t.danger
          : t.text;
  const border = variant === 'primary' ? t.accent : variant === 'highlight' ? t.saffron : t.border;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: 'error' | 'warn' | 'ok' | 'sim';
  children: ReactNode;
}) {
  const t = useTheme();
  const map = {
    error: [t.dangerBg, t.danger],
    warn: [t.warnBg, t.warn],
    ok: [t.okBg, t.ok],
    sim: [t.simBg, t.sim],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View
      style={[styles.banner, { backgroundColor: bg }]}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
    >
      <Text style={{ color: fg, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'sim' | 'danger';
}) {
  const t = useTheme();
  const map = {
    neutral: [t.border, t.muted],
    ok: [t.okBg, t.ok],
    warn: [t.warnBg, t.warn],
    sim: [t.simBg, t.sim],
    danger: [t.dangerBg, t.danger],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

/** Brand-coloured feature card (home screen). */
export function Hero({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.hero, { backgroundColor: t.heroBg }]}>{children}</View>;
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <ActivityIndicator color={t.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  h1: { fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
  h2: { fontSize: 18, fontWeight: '700' },
  button: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  banner: { borderRadius: 12, padding: 12 },
  hero: { borderRadius: 20, padding: 20, gap: 12, overflow: 'hidden' },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
});
