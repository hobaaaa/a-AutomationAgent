import { supabaseAdmin } from "@/lib/supabase";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const metricPayloadSchema = z.object({
  videoId: z.string().uuid(),
  channelKey: z.string().optional(),
  channelName: z.string().optional(),
  platform: z.enum(["youtube", "instagram", "tiktok"]),
  platformPostId: z.string().optional(),
  platformUrl: z.string().url().optional(),
  views: z.number().int().nonnegative().default(0),
  likes: z.number().int().nonnegative().default(0),
  comments: z.number().int().nonnegative().default(0),
  shares: z.number().int().nonnegative().default(0),
  watchTimeSeconds: z.number().nonnegative().optional(),
  averageViewDurationSeconds: z.number().nonnegative().optional(),
  publishedAt: z.string().datetime().optional(),
});

function isAuthorized(request: Request) {
  const ingestSecret = process.env.METRICS_INGEST_SECRET?.trim();

  if (!ingestSecret) {
    return true;
  }

  return request.headers.get("x-metrics-secret") === ingestSecret;
}

async function getVideoChannel(videoId: string) {
  const { data, error } = await supabaseAdmin
    .from("videos")
    .select("channel_key,channel_name")
    .eq("id", videoId)
    .maybeSingle<{
      channel_key: string | null;
      channel_name: string | null;
    }>();

  if (error) {
    throw new Error(`Could not fetch video channel: ${error.message}`);
  }

  return data;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const payload = metricPayloadSchema.parse(await request.json());
    const videoChannel = await getVideoChannel(payload.videoId);
    const { error } = await supabaseAdmin.from("video_platform_metrics").upsert(
      {
        video_id: payload.videoId,
        channel_key: payload.channelKey ?? videoChannel?.channel_key ?? null,
        channel_name: payload.channelName ?? videoChannel?.channel_name ?? null,
        platform: payload.platform,
        platform_post_id: payload.platformPostId ?? null,
        platform_url: payload.platformUrl ?? null,
        views: payload.views,
        likes: payload.likes,
        comments: payload.comments,
        shares: payload.shares,
        watch_time_seconds: payload.watchTimeSeconds ?? null,
        average_view_duration_seconds:
          payload.averageViewDurationSeconds ?? null,
        published_at: payload.publishedAt ?? null,
        collected_at: new Date().toISOString(),
      },
      {
        onConflict: "video_id,platform",
      }
    );

    if (error) {
      return NextResponse.json(
        {
          message: "Could not save metrics.",
          error: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "Metrics saved.",
      videoId: payload.videoId,
      channelKey: payload.channelKey ?? videoChannel?.channel_key ?? null,
      platform: payload.platform,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: "Invalid metrics payload.",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }
}
