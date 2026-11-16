import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z.string().url(),
    CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8081'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
    /** Secret pepper for hashing locker PINs. Server-only. */
    ACCESS_PIN_PEPPER: z.string().min(32, 'ACCESS_PIN_PEPPER must be at least 32 characters'),
    PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
    MOCK_PAYMENT_WEBHOOK_SECRET: z.string().min(16).optional(),
    PAYMENT_HOLD_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    QUOTE_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    DEVICE_OFFLINE_AFTER_SECONDS: z.coerce.number().int().min(10).default(90),
    UNLOCK_COMMAND_TTL_SECONDS: z.coerce.number().int().min(5).max(300).default(60),
    DOOR_CLOSE_TIMEOUT_SECONDS: z.coerce.number().int().min(30).default(300),
    PIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    SWEEPER_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(15),
    /** Enables the mock payment checkout helper. Never enable in production. */
    ENABLE_DEV_TOOLS: bool,
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'mock' && !env.MOCK_PAYMENT_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: 'custom',
        message: 'MOCK_PAYMENT_WEBHOOK_SECRET is required for the mock provider',
      });
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        message: 'The mock payment provider cannot run in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.ENABLE_DEV_TOOLS) {
      ctx.addIssue({ code: 'custom', message: 'ENABLE_DEV_TOOLS must be false in production' });
    }
  });

export type Config = z.infer<typeof envSchema>;

let cached: Config | undefined;
export function config(): Config {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`);
      throw new Error(`Invalid environment configuration:\n  ${issues.join('\n  ')}`);
    }
    cached = parsed.data;
  }
  return cached;
}
