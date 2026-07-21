import { assertSupabaseAdminEnv, supabaseAdmin } from "@/lib/supabase";
import { getDailyChannels } from "@/lib/channels";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_SCHEDULE_TIME_ZONE = "America/New_York";
const DEFAULT_FIRST_RUN_HOUR_LOCAL = 11;
const DEFAULT_CHANNEL_SPACING_MINUTES = 60;

function getIntegerEnv({
  defaultValue,
  name,
}: {
  defaultValue: number;
  name: string;
}) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return value;
}

function getUtcDayStart() {
  const now = new Date();

  return getUtcDayStartFromDate(now).toISOString();
}

function getUtcDayStartFromDate(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function getScheduleTimeZone() {
  return process.env.DAILY_SCHEDULE_TIME_ZONE || DEFAULT_SCHEDULE_TIME_ZONE;
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    month: parts.month,
    second: parts.second,
    year: parts.year,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return localAsUtc - date.getTime();
}

function getUtcDateForTimeZoneLocalTime({
  day,
  hour,
  minute,
  month,
  timeZone,
  year,
}: {
  day: number;
  hour: number;
  minute: number;
  month: number;
  timeZone: string;
  year: number;
}) {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utcDate = new Date(
    localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone)
  );

  utcDate = new Date(
    localAsUtc - getTimeZoneOffsetMs(utcDate, timeZone)
  );

  return utcDate;
}

function getScheduledAt(index: number) {
  const timeZone = getScheduleTimeZone();
  const firstRunHourLocal = getIntegerEnv({
    defaultValue: DEFAULT_FIRST_RUN_HOUR_LOCAL,
    name: "DAILY_FIRST_RUN_HOUR_LOCAL",
  });
  const channelSpacingMinutes = getIntegerEnv({
    defaultValue: DEFAULT_CHANNEL_SPACING_MINUTES,
    name: "DAILY_CHANNEL_SPACING_MINUTES",
  });
  const localToday = getTimeZoneParts(new Date(), timeZone);
  const scheduledAt = getUtcDateForTimeZoneLocalTime({
    day: localToday.day,
    hour: firstRunHourLocal,
    minute: index * channelSpacingMinutes,
    month: localToday.month,
    timeZone,
    year: localToday.year,
  });

  return scheduledAt.toISOString();
}

function isCronAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return true;
  }

  return (
    request.headers.get("x-cron-secret") === cronSecret ||
    request.headers.get("authorization") === `Bearer ${cronSecret}`
  );
}

export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    assertSupabaseAdminEnv();

    const channels = getDailyChannels();
    const dayStart = getUtcDayStart();
    const { data, error } = await supabaseAdmin
      .from("videos")
      .select("channel_key")
      .gte("created_at", dayStart);

    if (error) {
      throw new Error(`Daily video count query failed: ${error.message}`);
    }

    const existingChannelKeys = new Set(
      (data ?? [])
        .map((row) => row.channel_key)
        .filter((key): key is string => typeof key === "string" && key.length > 0)
    );
    const channelsToCreate = channels.filter(
      (channel) => !existingChannelKeys.has(channel.key)
    );

    if (channelsToCreate.length === 0) {
      return NextResponse.json({
        message: "Daily channel queue already filled.",
        target: channels.length,
        existingTodayCount: existingChannelKeys.size,
        created: 0,
        scheduleTimeZone: getScheduleTimeZone(),
        channels: [],
      });
    }

    const rows = channelsToCreate.map((channel) => ({
      channel_key: channel.key,
      channel_name: channel.name,
      niche: channel.niche,
      scheduled_at: getScheduledAt(
        channels.findIndex((candidate) => candidate.key === channel.key)
      ),
      status: "pending",
      retry_count: 0,
    }));
    const { error: insertError } = await supabaseAdmin
      .from("videos")
      .insert(rows);

    if (insertError) {
      throw new Error(`Daily video seed insert failed: ${insertError.message}`);
    }

    return NextResponse.json({
      message: "Daily channel queue seeded.",
      target: channels.length,
      existingTodayCount: existingChannelKeys.size,
      created: rows.length,
      scheduleTimeZone: getScheduleTimeZone(),
      channels: rows.map((row) => ({
        key: row.channel_key,
        name: row.channel_name,
        niche: row.niche,
        scheduledAt: row.scheduled_at,
      })),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return NextResponse.json(
      {
        message: "Could not seed daily queue.",
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
