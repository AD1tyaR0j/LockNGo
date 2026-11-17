import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import type { BookingDetail } from '@sl/shared';
import { BookingRow, LIVE_STATUSES } from '../components/booking-row';
import { Banner, Button, H2, Hero, P, Screen, useTheme } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Home() {
  const { user, signOut } = useAuth();
  const t = useTheme();
  const [items, setItems] = useState<BookingDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.bookings();
      setItems(r.items.filter((b) => LIVE_STATUSES.has(b.status)));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load bookings');
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Hero>
        <Text style={{ color: t.heroMuted, fontSize: 15, fontWeight: '600' }}>
          Hi {user?.name.split(' ')[0]} 👋
        </Text>
        <Text
          accessibilityRole="header"
          style={{ color: t.heroText, fontSize: 26, fontWeight: '800', letterSpacing: -0.3 }}
        >
          Travel light. Store your bags.
        </Text>
        <Text style={{ color: t.heroMuted, fontSize: 15, lineHeight: 21 }}>
          Book a locker by size and hours, pay, then open it right from this app.
        </Text>
        <Button
          testID="store"
          variant="highlight"
          title="Find a locker"
          onPress={() => router.push('/outlets')}
        />
      </Hero>
      <P muted style={{ fontSize: 13 }}>
        Sending and receiving parcels is planned for a later release.
      </P>

      <H2>Active bookings</H2>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {items === null && !error ? <P muted>Loading…</P> : null}
      {items?.length === 0 ? <P muted>No active bookings.</P> : null}
      {items?.map((b) => (
        <BookingRow key={b.id} b={b} />
      ))}

      <View style={{ gap: 10, marginTop: 8 }}>
        <Button variant="secondary" title="All activity" onPress={() => router.push('/bookings')} />
        <Button variant="secondary" title="Sign out" onPress={signOut} />
      </View>
    </Screen>
  );
}
