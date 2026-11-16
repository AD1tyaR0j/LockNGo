CREATE TYPE "public"."access_purpose" AS ENUM('DEPOSIT', 'RETRIEVE');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('USER', 'DEVICE', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('PENDING_PAYMENT', 'CONFIRMED', 'ACCESS_READY', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED');--> statement-breakpoint
CREATE TYPE "public"."compartment_operational_status" AS ENUM('IN_SERVICE', 'NEEDS_INSPECTION', 'OUT_OF_SERVICE');--> statement-breakpoint
CREATE TYPE "public"."compartment_size" AS ENUM('S', 'M', 'L', 'XL');--> statement-breakpoint
CREATE TYPE "public"."device_command_status" AS ENUM('PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED', 'EXPIRED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('PROVISIONED', 'ONLINE', 'OFFLINE', 'FAULT', 'DECOMMISSIONED');--> statement-breakpoint
CREATE TYPE "public"."door_state" AS ENUM('OPEN', 'CLOSED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."outlet_status" AS ENUM('DRAFT', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('CREATED', 'CAPTURED', 'FAILED', 'REFUND_REQUIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."role_name" AS ENUM('CUSTOMER', 'COURIER', 'HOST_PARTNER', 'OUTLET_OPERATOR', 'MAINTENANCE_TECHNICIAN', 'SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN');--> statement-breakpoint
CREATE TABLE "access_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"compartment_id" uuid NOT NULL,
	"credential_hash" text NOT NULL,
	"credential_type" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"from_status" "booking_status",
	"to_status" "booking_status",
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compartments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locker_bank_id" uuid NOT NULL,
	"code" text NOT NULL,
	"size" "compartment_size" NOT NULL,
	"max_weight_grams" integer NOT NULL,
	"operational_status" "compartment_operational_status" DEFAULT 'IN_SERVICE' NOT NULL,
	"door_state" "door_state" DEFAULT 'UNKNOWN' NOT NULL,
	"door_state_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compartments_weight_positive" CHECK ("compartments"."max_weight_grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "device_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"compartment_id" uuid NOT NULL,
	"booking_id" uuid,
	"command_type" text NOT NULL,
	"purpose" "access_purpose" NOT NULL,
	"requested_by" uuid,
	"status" "device_command_status" DEFAULT 'PENDING' NOT NULL,
	"nonce" text NOT NULL,
	"result_detail" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"door_opened_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "device_commands_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "device_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"compartment_id" uuid,
	"command_id" uuid,
	"event_type" text NOT NULL,
	"sequence" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verification_status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_health_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"connectivity" text NOT NULL,
	"power_state" text NOT NULL,
	"firmware_version" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_identifier" text NOT NULL,
	"locker_bank_id" uuid NOT NULL,
	"hardware_model" text NOT NULL,
	"firmware_version" text NOT NULL,
	"status" "device_status" DEFAULT 'PROVISIONED' NOT NULL,
	"is_simulated" boolean NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_sequence" bigint DEFAULT -1 NOT NULL,
	"credential_hash" text NOT NULL,
	"credential_rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_device_identifier_unique" UNIQUE("device_identifier"),
	CONSTRAINT "devices_locker_bank_id_unique" UNIQUE("locker_bank_id")
);
--> statement-breakpoint
CREATE TABLE "locker_banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"label" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"operating_hours" jsonb NOT NULL,
	"status" "outlet_status" DEFAULT 'DRAFT' NOT NULL,
	"host_partner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_payment_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "payment_status" NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_order_id_unique" UNIQUE("provider_order_id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "price_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_type" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"size" "compartment_size" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"breakdown" jsonb NOT NULL,
	"pricing_rule_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"size" "compartment_size" NOT NULL,
	"base_amount_minor" integer NOT NULL,
	"per_hour_amount_minor" integer NOT NULL,
	"tax_bps" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_non_negative" CHECK ("pricing_rules"."base_amount_minor" >= 0 AND "pricing_rules"."per_hour_amount_minor" >= 0 AND "pricing_rules"."tax_bps" >= 0)
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" "role_name" NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "storage_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"compartment_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "booking_status" NOT NULL,
	"payment_hold_expires_at" timestamp with time zone,
	"price_quote_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"idempotency_key" text NOT NULL,
	"deposited_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_bookings_reference_unique" UNIQUE("reference"),
	CONSTRAINT "storage_bookings_price_quote_id_unique" UNIQUE("price_quote_id"),
	CONSTRAINT "storage_bookings_range_valid" CHECK ("storage_bookings"."expires_at" > "storage_bookings"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_booking_id_storage_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."storage_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_credentials" ADD CONSTRAINT "access_credentials_compartment_id_compartments_id_fk" FOREIGN KEY ("compartment_id") REFERENCES "public"."compartments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_storage_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."storage_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compartments" ADD CONSTRAINT "compartments_locker_bank_id_locker_banks_id_fk" FOREIGN KEY ("locker_bank_id") REFERENCES "public"."locker_banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_compartment_id_compartments_id_fk" FOREIGN KEY ("compartment_id") REFERENCES "public"."compartments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_booking_id_storage_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."storage_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_compartment_id_compartments_id_fk" FOREIGN KEY ("compartment_id") REFERENCES "public"."compartments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_health_snapshots" ADD CONSTRAINT "device_health_snapshots_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_locker_bank_id_locker_banks_id_fk" FOREIGN KEY ("locker_bank_id") REFERENCES "public"."locker_banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locker_banks" ADD CONSTRAINT "locker_banks_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_storage_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."storage_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_pricing_rule_id_pricing_rules_id_fk" FOREIGN KEY ("pricing_rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_bookings" ADD CONSTRAINT "storage_bookings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_bookings" ADD CONSTRAINT "storage_bookings_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_bookings" ADD CONSTRAINT "storage_bookings_compartment_id_compartments_id_fk" FOREIGN KEY ("compartment_id") REFERENCES "public"."compartments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_bookings" ADD CONSTRAINT "storage_bookings_price_quote_id_price_quotes_id_fk" FOREIGN KEY ("price_quote_id") REFERENCES "public"."price_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_credentials_one_live_per_booking_uq" ON "access_credentials" USING btree ("booking_id") WHERE "access_credentials"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "booking_events_booking_idx" ON "booking_events" USING btree ("booking_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "compartments_bank_code_uq" ON "compartments" USING btree ("locker_bank_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "device_commands_one_inflight_per_compartment_uq" ON "device_commands" USING btree ("compartment_id") WHERE "device_commands"."status" IN ('PENDING','DELIVERED','ACKNOWLEDGED');--> statement-breakpoint
CREATE INDEX "device_commands_device_status_idx" ON "device_commands" USING btree ("device_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "device_events_device_event_uq" ON "device_events" USING btree ("device_id","event_id");--> statement-breakpoint
CREATE INDEX "device_events_device_received_idx" ON "device_events" USING btree ("device_id","received_at");--> statement-breakpoint
CREATE INDEX "device_health_device_idx" ON "device_health_snapshots" USING btree ("device_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "locker_banks_outlet_label_uq" ON "locker_banks" USING btree ("outlet_id","label");--> statement-breakpoint
CREATE INDEX "outlets_status_city_idx" ON "outlets" USING btree ("status","city");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_uq" ON "payment_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_rules_size_version_uq" ON "pricing_rules" USING btree ("size","version");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_rules_one_active_per_size_uq" ON "pricing_rules" USING btree ("size") WHERE "pricing_rules"."is_active";--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_bookings_customer_idem_uq" ON "storage_bookings" USING btree ("customer_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "storage_bookings_customer_idx" ON "storage_bookings" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "storage_bookings_compartment_idx" ON "storage_bookings" USING btree ("compartment_id","status");--> statement-breakpoint
CREATE INDEX "storage_bookings_status_idx" ON "storage_bookings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));