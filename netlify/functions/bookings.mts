import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { bookings } from "../../db/schema.js";
import { and, eq, or, lt, gt } from "drizzle-orm";

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export default async (req: Request) => {
  const url = new URL(req.url);

  // GET /api/bookings?date=YYYY-MM-DD → booked slots for that date
  if (req.method === "GET") {
    const date = url.searchParams.get("date");
    if (!date || !isValidDate(date)) {
      return Response.json({ error: "Valid date query param required (YYYY-MM-DD)" }, { status: 400 });
    }
    const rows = await db
      .select({ timeFrom: bookings.timeFrom, timeTo: bookings.timeTo })
      .from(bookings)
      .where(eq(bookings.date, date));
    return Response.json({ booked: rows });
  }

  // POST /api/bookings → reserve a slot
  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { name, phone, service, date, dateTo, timeFrom, timeTo } = body as Record<string, string>;

    if (!name || !phone || !service || !date || !timeFrom || !timeTo) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!isValidDate(date) || (dateTo && !isValidDate(dateTo))) {
      return Response.json({ error: "Invalid date format" }, { status: 400 });
    }
    if (!isValidTime(timeFrom) || !isValidTime(timeTo)) {
      return Response.json({ error: "Invalid time format" }, { status: 400 });
    }
    if (timeFrom >= timeTo) {
      return Response.json({ error: "End time must be after start time" }, { status: 400 });
    }
    if (dateTo && dateTo < date) {
      return Response.json({ error: "End date must be after start date" }, { status: 400 });
    }

    // For wedding packages, reserve every day in the range (max 30 days)
    if (dateTo) {
      const start = new Date(`${date}T00:00:00Z`).getTime();
      const end = new Date(`${dateTo}T00:00:00Z`).getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      const days = Math.round((end - start) / dayMs) + 1;
      if (days < 1 || days > 30) {
        return Response.json({ error: "Wedding range must be between 1 and 30 days" }, { status: 400 });
      }

      const dates: string[] = [];
      for (let d = 0; d < days; d++) {
        dates.push(new Date(start + d * dayMs).toISOString().slice(0, 10));
      }

      const existing = await db
        .select({ date: bookings.date, timeFrom: bookings.timeFrom, timeTo: bookings.timeTo })
        .from(bookings)
        .where(or(...dates.map((d) => eq(bookings.date, d))));

      const clash = existing.find(
        (b) => b.timeFrom < timeTo && timeFrom < b.timeTo
      );
      if (clash) {
        return Response.json(
          { error: "One of the selected days is already booked. Please choose another time." },
          { status: 409 }
        );
      }

      await db.insert(bookings).values(
        dates.map((d) => ({
          name,
          phone,
          service,
          date: d,
          dateTo: null,
          timeFrom,
          timeTo,
        }))
      );

      return Response.json({ ok: true, reservedDays: dates }, { status: 201 });
    }

    // Single appointment: check overlap for the date
    const clash = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.date, date),
          lt(bookings.timeFrom, timeTo),
          gt(bookings.timeTo, timeFrom)
        )
      )
      .limit(1);

    if (clash.length > 0) {
      return Response.json(
        { error: "That time is already booked. Please select any other time." },
        { status: 409 }
      );
    }

    await db.insert(bookings).values({
      name,
      phone,
      service,
      date,
      dateTo: null,
      timeFrom,
      timeTo,
    });

    return Response.json({ ok: true }, { status: 201 });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/bookings",
};
