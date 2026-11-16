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

const light = {
  bg: '#f5f6f8',
  surface: '#ffffff',
  border: '#dde1e7',
  text: '#16191f',
  muted: '#5b6472',
  accent: '#0f6e5a',
  accentText: '#ffffff',
  danger: '#b42318',
  dangerBg: '#fde7e5',
  warnBg: '#fdf1d6',
  warn: '#8a5a00',
  okBg: '#e3f4e8',
  ok: '#1d7a3e',
  simBg: '#f1e9fb',
  sim: '#6b3fa0',
};
const dark: typeof light = {
  bg: '#101317',
  surface: '#181c22',
  border: '#2e353e',
  text: '#e8ebef',
  muted: '#9aa4b2',
  accent: '#3cc7a3',
  accentText: '#06231c',
  danger: '#ff8a80',
  dangerBg: '#3d1714',
  warnBg: '#3a2c0e',
  warn: '#f2c063',
  okBg: '#173622',
  ok: '#6fd391',
  simBg: '#2b1d3d',
  sim: '#c7a6f2',
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
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>
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
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.accent : t.surface;
  const fg = variant === 'primary' ? t.accentText : variant === 'danger' ? t.danger : t.text;
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
          borderColor: variant === 'primary' ? t.accent : t.border,
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
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  h1: { fontSize: 24, fontWeight: '700' },
  h2: { fontSize: 18, fontWeight: '700' },
  button: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  banner: { borderRadius: 10, padding: 12 },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
});
