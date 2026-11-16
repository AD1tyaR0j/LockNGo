import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import type { BookingDetail } from '@sl/shared';
import { BookingRow } from '../../components/booking-row';
import { Banner, Loading, P, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

export default function Activity() {
  const [items, setItems] = useState<BookingDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      api
        .bookings()
        .then((r) => setItems(r.items))
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load activity'));
    }, []),
  );
  if (error)
    return (
      <Screen>
        <Banner tone="error">{error}</Banner>
      </Screen>
    );
  if (!items) return <Loading />;
  return (
    <Screen>
      {items.length === 0 ? <P muted>No bookings yet.</P> : null}
      {items.map((b) => (
        <BookingRow key={b.id} b={b} />
      ))}
    </Screen>
  );
}
