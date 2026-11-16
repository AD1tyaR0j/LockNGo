/**
 * Provider-independent payment interface. A real gateway adapter (e.g. Razorpay) implements
 * this once merchant onboarding is complete. Booking state is only ever changed from a
 * verified webhook (`parseVerifiedWebhook`), never from a client-reported success screen.
 */
export interface CreateOrderInput {
  /** Our payment id; used as the provider-side idempotency key / receipt. */
  idempotencyKey: string;
  amountMinor: number;
  currency: 'INR';
}

export interface ProviderOrder {
  providerOrderId: string;
}

export type VerifiedPaymentEvent =
  | {
      providerEventId: string;
      type: 'payment.captured';
      providerOrderId: string;
      providerPaymentId: string;
      amountMinor: number;
      currency: string;
    }
  | {
      providerEventId: string;
      type: 'payment.failed';
      providerOrderId: string;
      reason: string;
    };

export interface PaymentProvider {
  readonly name: string;
  /** True for development providers where no money moves. */
  readonly isMock: boolean;
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  /** Verifies the signature over the raw body and parses the event. Throws on bad signature. */
  parseVerifiedWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): VerifiedPaymentEvent;
  /** Placeholder for Phase 1 hardening; mock records intent only. */
  initiateRefund(providerPaymentId: string, amountMinor: number): Promise<{ providerRefundId: string }>;
}
