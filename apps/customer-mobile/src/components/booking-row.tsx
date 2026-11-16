import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { BookingDetail } from '@sl/shared';
import { formatTime, STATUS_LABEL } from '../lib/format';
import { Card, P, Pill } from './ui';

export const LIVE_STATUSES = new Set([
  'PENDING_PAYMENT',
  'CONFIRMED',
  'ACCESS_READY',
  'ACTIVE',
  'DISPUTED',
]);

export function BookingRow({ b }: { b: BookingDetail }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/bookings/${b.id}`)}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <P style={{ fontWeight: '700', flexShrink: 1 }}>{b.outlet.name}</P>
          <Pill
            label={STATUS_LABEL[b.status] ?? b.status}
            tone={b.status === 'ACTIVE' ? 'ok' : LIVE_STATUSES.has(b.status) ? 'warn' : 'neutral'}
          />
        </View>
        <P muted>
          Locker {b.compartment.code} · until {formatTime(b.expiresAt)} · {b.reference}
        </P>
      </Card>
    </Pressable>
  );
}
