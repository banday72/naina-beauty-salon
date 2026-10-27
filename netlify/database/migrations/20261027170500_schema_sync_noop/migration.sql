-- No-op migration: the schema changes (services, staff, customers, coupons,
-- payments tables and the extra bookings columns) were already applied to the
-- database branch by the 20261027170000_phase3_business_features migration.
-- This migration exists to keep the drizzle snapshot chain in sync with the
-- current schema (see snapshot.json) and applies no statements.
SELECT 1;
