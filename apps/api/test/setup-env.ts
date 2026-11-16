// Test environment. Values here are throwaway test fixtures, not real secrets.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/smartlocker_test';
process.env.ACCESS_PIN_PEPPER = 'test-pepper-test-pepper-test-pepper-0000';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.MOCK_PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-0000';
process.env.ENABLE_DEV_TOOLS = 'true';
process.env.LOG_LEVEL = 'silent';
export {};
