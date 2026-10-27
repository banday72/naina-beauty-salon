CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"service" text NOT NULL,
	"date" date NOT NULL,
	"date_to" date,
	"time_from" time NOT NULL,
	"time_to" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
