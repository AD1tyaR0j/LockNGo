import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, RefreshControl, View } from 'react-native';
import type { AccessPurpose, BookingDetail, CredentialIssued } from '@sl/shared';
import { Banner, Button, Card, H1, H2, Loading, P, Pill, Screen } from '../../../components/ui';
import { api, ApiError } from '../../../lib/api';
import { formatInr, formatTime, SIZE_LABEL, STATUS_LABEL } from '../../../lib/format';

const EVENT_LABEL: Record<string, string> = {
  BOOKING_CREATED: 'Booking created',
  PAYMENT_CAPTURED: 'Payment confirmed',
  PAYMENT_FAILED: 'Payment failed',
  PAYMENT_HOLD_EXPIRED: 'Payment window expired',
  ACCESS_CREDENTIAL_ISSUED: 'Locker PIN issued',
  ACCESS_CREDENTIAL_REISSUED: 'Locker PIN re-issued',
  UNLOCK_REQUESTED: 'Unlock requested',
  UNLOCK_ACKNOWLEDGED: 'Locker unlocked',
  UNLOCK_FAILED: 'Locker could not unlock',
  UNLOCK_TIMED_OUT: 'Unlock timed out',
  DOOR_OPENED: 'Door opened',
  DOOR_CLOSED: 'Door closed',
  DOOR_LEFT_OPEN: 'Door left open — support notified',
  ITEMS_DEPOSITED: 'Items stored',
  ITEMS_RETRIEVED: 'Items collected',
  BOOKING_CANCELLED: 'Cancelled',
  BOOKING_WINDOW_ENDED_UNUSED: 'Expired unused',
};

function confirmAction(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) =>
    Alert.alert('Please confirm', message, [
      { text: 'No', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Yes', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [b, setB] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<CredentialIssued | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setB(await api.booking(id));
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load booking');
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Poll only while a physical action is in progress; status comes from the server.
  useEffect(() => {
    if (b?.pendingCommand && !timer.current) {
      timer.current = setInterval(() => void load(), 1500);
    } else if (!b?.pendingCommand && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, [b?.pendingCommand, load]);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!b)
    return error ? (
      <Screen>
        <Banner tone="error">{error}</Banner>
      </Screen>
    ) : (
      <Loading />
    );

  const purpose: AccessPurpose | null = b.nextAccessPurpose;
  const canCancel = ['PENDING_PAYMENT', 'CONFIRMED', 'ACCESS_READY'].includes(b.status);
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
      <View style={{ gap: 6 }}>
        <Pill
          label={STATUS_LABEL[b.status] ?? b.status}
          tone={b.status === 'ACTIVE' ? 'ok' : b.status === 'PENDING_PAYMENT' ? 'warn' : 'neutral'}
        />
        <H1>Locker {b.compartment.code}</H1>
        <P muted>
          {b.outlet.name} · bank {b.compartment.lockerBankLabel} · {SIZE_LABEL[b.compartment.size]}
        </P>
        <P muted style={{ fontSize: 12 }}>
          {b.reference} · updated{' '}
          {lastUpdated
            ? lastUpdated.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
            : '—'}
        </P>
      </View>
      {b.compartment.isSimulated ? (
        <Banner tone="sim">
          SIMULATED locker: door events come from the development simulator, not real hardware.
        </Banner>
      ) : null}

      {b.status === 'PENDING_PAYMENT' ? (
        <Card>
          <P>Complete payment to confirm this locker.</P>
          <Button title="Go to payment" onPress={() => router.push(`/bookings/${b.id}/pay`)} />
        </Card>
      ) : null}

      {purpose ? (
        <Card>
          <H2>{purpose === 'DEPOSIT' ? 'Store your items' : 'Collect your items'}</H2>
          <P muted>
            {purpose === 'DEPOSIT'
              ? 'At the locker, tap below to open it. Put your items in and close the door firmly.'
              : 'At the locker, tap below to open it. Take your items and close the door.'}
          </P>
          {b.pendingCommand ? (
            <Banner tone="warn">
              {b.pendingCommand.status === 'PENDING' || b.pendingCommand.status === 'DELIVERED'
                ? 'Opening locker…'
                : 'Locker open — close the door when you are done.'}
            </Banner>
          ) : null}
          <Button
            testID="open-locker"
            title={purpose === 'DEPOSIT' ? 'Open locker to store' : 'Open locker to collect'}
            onPress={() => run('access', () => api.requestAccess(b.id, purpose))}
            loading={busy === 'access'}
            disabled={!!b.pendingCommand}
          />
        </Card>
      ) : null}

      {['CONFIRMED', 'ACCESS_READY', 'ACTIVE'].includes(b.status) ? (
        <Card>
          <H2>Locker keypad PIN</H2>
          {pin ? (
            <>
              <P style={{ fontSize: 32, fontWeight: '700', letterSpacing: 6 }} testID="pin">
                {pin.pin}
              </P>
              <P muted>Shown once. Don&apos;t share it. Valid until {formatTime(pin.expiresAt)}.</P>
            </>
          ) : (
            <P muted>
              Use a PIN at the locker keypad if your phone is unavailable. Getting a new PIN cancels
              any earlier one.
            </P>
          )}
          <Button
            variant="secondary"
            title={b.status === 'CONFIRMED' ? 'Get PIN' : 'Get a new PIN'}
            onPress={() => run('pin', async () => setPin(await api.issuePin(b.id)))}
            loading={busy === 'pin'}
          />
        </Card>
      ) : null}

      {error ? <Banner tone="error">{error}</Banner> : null}

      <Card>
        <H2>Details</H2>
        <P>From {formatTime(b.startsAt)}</P>
        <P>Paid until {formatTime(b.expiresAt)}</P>
        {b.breakdown.map((l) => (
          <View key={l.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <P muted>{l.label}</P>
            <P muted>{formatInr(l.amountMinor)}</P>
          </View>
        ))}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <P style={{ fontWeight: '700' }}>Total</P>
          <P style={{ fontWeight: '700' }}>{formatInr(b.total.amountMinor)}</P>
        </View>
        {b.payment ? (
          <P muted style={{ fontSize: 13 }}>
            Payment: {b.payment.status.replaceAll('_', ' ').toLowerCase()}
            {b.payment.isMock ? ' (test payment)' : ''}
          </P>
        ) : null}
      </Card>

      <Card>
        <H2>Timeline</H2>
        {b.events.map((e) => (
          <View
            key={e.id}
            style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}
          >
            <P style={{ flexShrink: 1 }}>{EVENT_LABEL[e.type] ?? e.type}</P>
            <P muted>{formatTime(e.createdAt)}</P>
          </View>
        ))}
      </Card>

      {canCancel ? (
        <Button
          variant="danger"
          title="Cancel booking"
          loading={busy === 'cancel'}
          onPress={async () => {
            if (
              await confirmAction('Cancel this booking? Refunds follow the cancellation policy.')
            ) {
              await run('cancel', () => api.cancel(b.id));
            }
          }}
        />
      ) : null}
      {b.status === 'ACTIVE' ? (
        <P muted style={{ fontSize: 13 }}>
          Items stored. Cancelling is not possible until they are collected.
        </P>
      ) : null}
    </Screen>
  );
}
