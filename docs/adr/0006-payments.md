# ADR 0006 — Payment provider abstraction

**Status:** Accepted

`PaymentProvider` (createOrder, parseVerifiedWebhook, initiateRefund) isolates the gateway.
Milestone 1 ships only `MockPaymentProvider`. It creates orders server-side and emits
HMAC-signed webhooks that go through the same verification and idempotent processing a real
gateway's would. The development-only "mock checkout" endpoint asks the mock gateway to send that
webhook. It never changes booking state itself. Config refuses the mock provider and dev tools when
`NODE_ENV=production`.

Money is integer paise plus currency. The accepted quote, with its breakdown and pricing-rule id, is snapshotted
so later price changes never rewrite history. Webhook events are recorded in
`payment_webhook_events` (unique per provider + event id) in the same transaction as their effects.
