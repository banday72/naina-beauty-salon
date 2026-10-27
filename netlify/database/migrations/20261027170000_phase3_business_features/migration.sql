CREATE TABLE "services" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL UNIQUE,
  "description" text NOT NULL DEFAULT '',
  "price" integer NOT NULL DEFAULT 0,
  "duration_mins" integer NOT NULL DEFAULT 60,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE "staff" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "phone" text,
  "role" text NOT NULL DEFAULT 'beautician',
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE "customers" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "phone" text NOT NULL UNIQUE,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE "coupons" (
  "id" serial PRIMARY KEY,
  "code" text NOT NULL UNIQUE,
  "discount_percent" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "expires_at" date,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE "payments" (
  "id" serial PRIMARY KEY,
  "booking_id" integer NOT NULL,
  "amount" integer NOT NULL,
  "method" text NOT NULL DEFAULT 'cash',
  "status" text NOT NULL DEFAULT 'pending',
  "reference" text,
  "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE "bookings" ADD COLUMN "customer_id" integer;
ALTER TABLE "bookings" ADD COLUMN "staff_id" integer;
ALTER TABLE "bookings" ADD COLUMN "status" text NOT NULL DEFAULT 'pending';
ALTER TABLE "bookings" ADD COLUMN "amount" integer NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ADD COLUMN "deposit_amount" integer NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ADD COLUMN "payment_status" text NOT NULL DEFAULT 'unpaid';
ALTER TABLE "bookings" ADD COLUMN "coupon_code" text;
ALTER TABLE "bookings" ADD COLUMN "referral_code" text;

CREATE INDEX "bookings_date_status_idx" ON "bookings" ("date", "status");
CREATE INDEX "bookings_customer_idx" ON "bookings" ("customer_id");
CREATE INDEX "payments_booking_idx" ON "payments" ("booking_id");

INSERT INTO "services" ("name", "description", "price", "duration_mins") VALUES
  ('Bridal Makeup', 'Complete bridal makeup and styling.', 0, 180),
  ('Facial', 'Glow-boosting facial treatment.', 0, 60),
  ('Waxing', 'Gentle professional waxing service.', 0, 60),
  ('Mehndi', 'Traditional and modern mehndi designs.', 0, 120),
  ('Mani Pedi', 'Relaxing hand and foot care.', 0, 90),
  ('Party Makeup', 'Glam makeup for special occasions.', 0, 120),
  ('Wedding Package (3 Days)', 'Mehndi, Baraat and Walima package.', 0, 240)
ON CONFLICT ("name") DO NOTHING;
