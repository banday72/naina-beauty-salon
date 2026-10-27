import type { Config } from "@netlify/functions";
import { and, eq, gt, lt, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings, coupons, customers, services } from "../../db/schema.js";

const OPEN_TIME = "09:00";
const CLOSE_TIME = "20:00";
const ACTIVE_STATUSES = ["pending", "confirmed"];

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === value;
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidPhone(value: string): boolean {
  return /^03\d{9}$/.test(value.replace(/[\s-]/g, ""));
}

function todayInPakistan(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

async function findOrCreateCustomer(name: string, phone: string): Promise<number> {
  const normalizedPhone = phone.replace(/[\s-]/g, "");
  const existing = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.phone, normalizedPhone))
    .limit(1);
  if (existing[0]) {
    await db.update(customers).set({ name }).where(eq(customers.id, existing[0].id));
    return existing[0].id;
  }
  const inserted = await db
    .insert(customers)
    .values({ name, phone: normalizedPhone })
    .returning({ id: customers.id });
  return inserted[0].id;
}

async function getQuote(serviceName: string, couponCode?: string) {
  const service = await db
    .select({
      name: services.name,
      price: services.price,
      durationMins: services.durationMins,
      active: services.active,
    })
    .from(services)
    .where(eq(services.name, serviceName))
    .limit(1);
  if (!service[0] || !service[0].active) return null;

  let amount = service[0].price;
  let appliedCoupon: string | null = null;
  if (couponCode) {
    const code = couponCode.trim().toUpperCase();
    const coupon = await db
      .select({
        code: coupons.code,
        discountPercent: coupons.discountPercent,
        expiresAt: coupons.expiresAt,
      })
      .from(coupons)
      .where(and(eq(coupons.code, code), eq(coupons.active, true)))
      .limit(1);
    if (coupon[0] && (!coupon[0].expiresAt || coupon[0].expiresAt >= todayInPakistan())) {
      amount = Math.max(0, Math.round(amount * (100 - coupon[0].discountPercent) / 100));
      appliedCoupon = coupon[0].code;
    }
  }
  return { ...service[0], amount, couponCode: appliedCoupon };
}

async function hasClash(date: string, timeFrom: string, timeTo: string): Promise<boolean> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.date, date),
        or(eq(bookings.status, "pending"), eq(bookings.status, "confirmed")),
        lt(bookings.timeFrom, timeTo),
        gt(bookings.timeTo, timeFrom),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export default async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const date = url.searchParams.get("date");
    if (url.searchParams.get("services") === "1") {
      const rows = await db
        .select({
          name: services.name,
          description: services.description,
          price: services.price,
          durationMins: services.durationMins,
        })
        .from(services)
        .where(eq(services.active, true));
      return Response.json({ services: rows });
    }
    if (!date || !isValidDate(date)) return bad("Valid date query param required (YYYY-MM-DD)");
    const rows = await db
      .select({ timeFrom: bookings.timeFrom, timeTo: bookings.timeTo })
      .from(bookings)
      .where(
        and(
          eq(bookings.date, date),
          or(eq(bookings.status, "pending"), eq(bookings.status, "confirmed")),
        ),
      );
    return Response.json({ booked: rows });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const serviceName = typeof body.service === "string" ? body.service.trim() : "";
  const date = typeof body.date === "string" ? body.date : "";
  const dateTo = typeof body.dateTo === "string" && body.dateTo ? body.dateTo : null;
  const timeFrom = typeof body.timeFrom === "string" ? body.timeFrom : "";
  const timeTo = typeof body.timeTo === "string" ? body.timeTo : "";
  const couponCode = typeof body.couponCode === "string" ? body.couponCode : undefined;
  const referralCode = typeof body.referralCode === "string" ? body.referralCode.trim() : null;

  if (name.length < 2 || name.length > 100) return bad("Name must be between 2 and 100 characters");
  if (!isValidPhone(phone)) return bad("Enter a valid Pakistani mobile number");
  if (!isValidDate(date) || (dateTo && !isValidDate(dateTo))) return bad("Invalid date format");
  if (date < todayInPakistan()) return bad("Bookings cannot be made for a past date");
  if (!isValidTime(timeFrom) || !isValidTime(timeTo)) return bad("Invalid time format");
  if (timeFrom < OPEN_TIME || timeTo > CLOSE_TIME || timeFrom >= timeTo) {
    return bad("Appointments must be within 9:00 AM and 8:00 PM");
  }
  if (dateTo && dateTo < date) return bad("End date must be on or after the start date");

  const quote = await getQuote(serviceName, couponCode);
  if (!quote) return bad("Selected service is not available", 422);
  const requestedMinutes = (Number(timeTo.slice(0, 2)) * 60 + Number(timeTo.slice(3))) -
    (Number(timeFrom.slice(0, 2)) * 60 + Number(timeFrom.slice(3)));
  if (requestedMinutes < quote.durationMins) {
    return bad(`This service requires at least ${quote.durationMins} minutes`);
  }

  const customerId = await findOrCreateCustomer(name, phone);
  const dates: string[] = [];
  if (dateTo) {
    const start = new Date(`${date}T00:00:00Z`).getTime();
    const end = new Date(`${dateTo}T00:00:00Z`).getTime();
    const days = Math.round((end - start) / 86400000) + 1;
    if (days < 1 || days > 30) return bad("Wedding range must be between 1 and 30 days");
    for (let index = 0; index < days; index++) {
      dates.push(new Date(start + index * 86400000).toISOString().slice(0, 10));
    }
  } else {
    dates.push(date);
  }

  for (const requestedDate of dates) {
    if (await hasClash(requestedDate, timeFrom, timeTo)) {
      return Response.json({ error: "That time is already booked. Please select another time." }, { status: 409 });
    }
  }

  const inserted = await db
    .insert(bookings)
    .values(
      dates.map((requestedDate) => ({
        name,
        phone: phone.replace(/[\s-]/g, ""),
        service: serviceName,
        customerId,
        date: requestedDate,
        dateTo: null,
        timeFrom,
        timeTo,
        amount: quote.amount,
        couponCode: quote.couponCode,
        referralCode,
        status: "pending",
        paymentStatus: "unpaid",
      })),
    )
    .returning({ id: bookings.id });

  return Response.json({
    ok: true,
    bookingId: inserted[0]?.id,
    reservedDays: dates,
    amount: quote.amount,
    durationMins: quote.durationMins,
    couponCode: quote.couponCode,
  }, { status: 201 });
};

export const config: Config = { path: "/api/bookings" };
