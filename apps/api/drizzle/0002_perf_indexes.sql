CREATE INDEX "device_commands_booking_idx" ON "device_commands" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "storage_bookings_created_idx" ON "storage_bookings" USING btree ("created_at");