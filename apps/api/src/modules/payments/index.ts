import { config } from '../../config.js';
import { MockPaymentProvider } from './mock-provider.js';
import type { PaymentProvider } from './provider.js';

let provider: PaymentProvider | undefined;

export function paymentProvider(): PaymentProvider {
  if (!provider) {
    const cfg = config();
    switch (cfg.PAYMENT_PROVIDER) {
      case 'mock':
        provider = new MockPaymentProvider(cfg.MOCK_PAYMENT_WEBHOOK_SECRET!);
        break;
    }
  }
  return provider;
}

export function mockProvider(): MockPaymentProvider | undefined {
  const p = paymentProvider();
  return p instanceof MockPaymentProvider ? p : undefined;
}
