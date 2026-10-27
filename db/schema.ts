import { pgTable, serial, text, date, time, timestamp } from "drizzle-orm/pg-core";

export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  service: text("service").notNull(),
  date: date("date").notNull(),
  dateTo: date("date_to"),
  timeFrom: time("time_from").notNull(),
  timeTo: time("time_to").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
