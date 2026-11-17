import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BOOKING_LIMITS } from '@sl/shared/constants';
import type { CompartmentSize, OutletSummary, SizeAvailability, StorageQuote } from '@sl/shared';
import {
  Banner,
  Button,
  Card,
  H1,
  H2,
  Loading,
  P,
  Pill,
  Screen,
  useTheme,
} from '../../components/ui';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { formatInr, formatTime, SIZE_LABEL } from '../../lib/format';

const DURATIONS = [1, 2, 4, 8, 12, 24, 48].filter((h) => h <= BOOKING_LIMITS.maxHours);

export default function BookStorage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const [outlet, setOutlet] = useState<OutletSummary | null>(null);
  const [sizes, setSizes] = useState<SizeAvailability[] | null>(null);
  const [hours, setHours] = useState(2);
  const [size, setSize] = useState<CompartmentSize | null>(null);
  const [quote, setQuote] = useState<StorageQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One idempotency key per quote: retrying "Confirm" never creates a second booking.
  const idemKey = useRef<string>(newIdempotencyKey());

  useEffect(() => {
    api
      .outlet(id)
      .then(setOutlet)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load outlet'));
  }, [id]);
  useEffect(() => {
    setQuote(null);
    setSizes(null);
    api
      .availability(id, hours)
      .then((r) => setSizes(r.sizes))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load availability'));
  }, [id, hours]);

  async function getQuote() {
    if (!size) return;
    setBusy(true);
    setError(null);
    try {
      setQuote(await api.quote(id, size, hours));
      idemKey.current = newIdempotencyKey();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not get a price');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.book(quote.id, idemKey.current);
      router.replace(`/bookings/${r.booking.id}/pay`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Booking failed');
      if (
        e instanceof ApiError &&
        ['NO_AVAILABILITY', 'QUOTE_EXPIRED', 'QUOTE_USED'].includes(e.code)
      )
        setQuote(null);
    } finally {
      setBusy(false);
    }
  }

  if (!outlet)
    return error ? (
      <Screen>
        <Banner tone="error">{error}</Banner>
      </Screen>
    ) : (
      <Loading />
    );

  const chip = (selected: boolean, disabled = false) => [
    styles.chip,
    {
      borderColor: selected ? t.accent : t.border,
      backgroundColor: selected ? t.accent : t.surface,
      opacity: disabled ? 0.45 : 1,
    },
  ];
  return (
    <Screen>
      <H1>{outlet.name}</H1>
      <P muted>{outlet.address}</P>
      {outlet.hasSimulatedDevices ? (
        <Banner tone="sim">
          This outlet uses a SIMULATED locker for testing. No physical locker will open.
        </Banner>
      ) : null}

      <Card>
        <H2>How long?</H2>
        <View style={styles.wrap}>
          {DURATIONS.map((h) => (
            <Pressable
              key={h}
              accessibilityRole="button"
              accessibilityState={{ selected: h === hours }}
              onPress={() => setHours(h)}
              style={chip(h === hours)}
            >
              <Text style={{ color: h === hours ? t.accentText : t.text, fontWeight: '600' }}>
                {h < 24 ? `${h} h` : `${h / 24} day${h > 24 ? 's' : ''}`}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <H2>Locker size</H2>
        {!sizes ? <P muted>Checking availability…</P> : null}
        {sizes?.length === 0 ? <P muted>No lockers at this outlet yet.</P> : null}
        {sizes?.map((s) => {
          const none = s.available === 0;
          return (
            <Pressable
              key={s.size}
              testID={`size-${s.size}`}
              accessibilityRole="button"
              accessibilityState={{ selected: size === s.size, disabled: none }}
              disabled={none}
              onPress={() => {
                setSize(s.size);
                setQuote(null);
              }}
              style={[
                styles.sizeRow,
                { borderColor: size === s.size ? t.accent : t.border, opacity: none ? 0.5 : 1 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <P style={{ fontWeight: '700' }}>{SIZE_LABEL[s.size] ?? s.size}</P>
              </View>
              <Pill label={none ? 'Full' : `${s.available} free`} tone={none ? 'neutral' : 'ok'} />
            </Pressable>
          );
        })}
        <Button
          testID="get-quote"
          title="Get price"
          onPress={getQuote}
          disabled={!size}
          loading={busy && !quote}
        />
      </Card>

      {quote ? (
        <Card>
          <H2>Your price</H2>
          <P muted>
            {formatTime(quote.startsAt)} → {formatTime(quote.expiresAt)}
          </P>
          {quote.breakdown.map((l) => (
            <View key={l.label} style={styles.line}>
              <P>{l.label}</P>
              <P>{formatInr(l.amountMinor)}</P>
            </View>
          ))}
          <View
            style={[styles.line, { borderTopWidth: 1, borderTopColor: t.border, paddingTop: 8 }]}
          >
            <P style={{ fontWeight: '700' }}>Total</P>
            <P style={{ fontWeight: '800', fontSize: 18, color: t.highlight }}>
              {formatInr(quote.total.amountMinor)}
            </P>
          </View>
          <P muted style={{ fontSize: 13 }}>
            Price valid until {formatTime(quote.quoteExpiresAt)}. Locker is held for a few minutes
            while you pay.
          </P>
          <Button testID="confirm" title="Confirm and pay" onPress={confirm} loading={busy} />
        </Card>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
  },
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 12,
    minHeight: 56,
    gap: 8,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
});
