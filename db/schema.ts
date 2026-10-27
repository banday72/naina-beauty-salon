import {
  boolean,
  date,
  integer,
  pgTable,
  serial,
  text,
  time,
  timestamp,
} from "drizzle-orm/pg-core";

export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  service: text("service").notNull(),
  customerId: integer("customer_id"),
  staffId: integer("staff_id"),
  date: date("date").notNull(),
  dateTo: date("date_to"),
  timeFrom: time("time_from").notNull(),
  timeTo: time("time_to").notNull(),
  status: text("status").notNull().default("pending"),
  amount: integer("amount").notNull().default(0),
  depositAmount: integer("deposit_amount").notNull().default(0),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  couponCode: text("coupon_code"),
  referralCode: text("referral_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  price: integer("price").notNull().default(0),
  durationMins: integer("duration_mins").notNull().default(60),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  role: text("role").notNull().default("beautician"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const coupons = pgTable("coupons", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  discountPercent: integer("discount_percent").notNull().default(0),
  active: boolean("active").notNull().default(true),
  expiresAt: date("expires_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  amount: integer("amount").notNull(),
  method: text("method").notNull().default("cash"),
  status: text("status").notNull().default("pending"),
  reference: text("reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
