import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import type { BookingDetail } from '@sl/shared';
import { Banner, Button, Card, Loading, P, Screen, useTheme } from '../../../components/ui';
import { api, ApiError } from '../../../lib/api';
import { formatInr, formatTime } from '../../../lib/format';

/**
 * MOCK CHECKOUT. Stands in for a payment gateway's checkout sheet during development.
 * Buttons ask the mock gateway to send a signed webhook to the backend; the booking is
 * confirmed by that server-side webhook, never by this screen.
 */
export default function MockCheckout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const [b, setB] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'success' | 'failure' | null>(null);

  useEffect(() => {
    api
      .booking(id)
      .then(setB)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load booking'));
  }, [id]);

  async function pay(outcome: 'success' | 'failure') {
    if (!b?.payment) return;
    setBusy(outcome);
    setError(null);
    try {
      await api.mockPay(b.payment.id, outcome);
      // Read the result back from the server rather than trusting this screen.
      const fresh = await api.booking(id);
      if (fresh.status === 'PENDING_PAYMENT') {
        setB(fresh);
        setError('Payment not confirmed yet. Please wait and check your booking.');
        return;
      }
      router.replace(`/bookings/${id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Payment could not be completed');
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
  if (b.status !== 'PENDING_PAYMENT') {
    return (
      <Screen>
        <P>This booking is no longer awaiting payment.</P>
        <Button title="View booking" onPress={() => router.replace(`/bookings/${id}`)} />
      </Screen>
    );
  }
  return (
    <Screen>
      <Banner tone="sim">
        TEST PAYMENT — no real money moves. A real payment gateway (e.g. Razorpay) will replace this
        screen after merchant onboarding.
      </Banner>
      <P style={{ fontSize: 34, fontWeight: '800', color: t.highlight }}>
        {formatInr(b.total.amountMinor)}
      </P>
      <Card>
        <P>{b.outlet.name}</P>
        <P muted>
          Locker {b.compartment.code} · {formatTime(b.startsAt)} → {formatTime(b.expiresAt)}
        </P>
        {b.paymentHoldExpiresAt ? (
          <P muted>Locker held until {formatTime(b.paymentHoldExpiresAt)}</P>
        ) : null}
      </Card>
      <Button
        testID="pay-success"
        title="Simulate successful payment"
        onPress={() => pay('success')}
        loading={busy === 'success'}
        disabled={!!busy}
      />
      <Button
        testID="pay-failure"
        variant="danger"
        title="Simulate failed payment"
        onPress={() => pay('failure')}
        loading={busy === 'failure'}
        disabled={!!busy}
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
    </Screen>
  );
}
