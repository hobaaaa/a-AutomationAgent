import { supabaseAdmin } from "@/lib/supabase";

type VideoRecord = {
  id: string;
  niche: string | null;
  title: string | null;
  script: unknown;
};

type PlatformMetric = {
  video_id: string;
  platform: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  watch_time_seconds: number | null;
  average_view_duration_seconds: number | null;
};

type RankedVideo = {
  title: string;
  hook: string;
  score: number;
};

const ANALYTICS_VIDEO_LIMIT = 30;
const ANALYTICS_METRICS_LIMIT = 300;

function getScriptHook(script: unknown): string {
  if (!script || typeof script !== "object") {
    return "";
  }

  const candidate = script as {
    scenes?: Array<{ subtitle?: unknown }>;
    voice_over?: unknown;
  };
  const firstSubtitle = candidate.scenes?.[0]?.subtitle;

  if (typeof firstSubtitle === "string" && firstSubtitle.length > 0) {
    return firstSubtitle;
  }

  if (typeof candidate.voice_over === "string") {
    return candidate.voice_over.slice(0, 160);
  }

  return "";
}

function getMetricScore(metric: PlatformMetric) {
  const views = metric.views ?? 0;
  const likes = metric.likes ?? 0;
  const comments = metric.comments ?? 0;
  const shares = metric.shares ?? 0;
  const averageViewDuration = metric.average_view_duration_seconds ?? 0;

  return views + likes * 5 + comments * 8 + shares * 12 + averageViewDuration * 3;
}

function formatRankedVideos(videos: RankedVideo[]) {
  if (videos.length === 0) {
    return "No reliable historical winners yet. Use a clean, testable format.";
  }

  return videos
    .slice(0, 5)
    .map(
      (video, index) =>
        `${index + 1}. "${video.title}" | hook: "${video.hook}" | score: ${Math.round(
          video.score
        )}`
    )
    .join("\n");
}

export async function getStrategyContext(niche: string): Promise<string> {
  const { data: videos, error: videosError } = await supabaseAdmin
    .from("videos")
    .select("id,niche,title,script")
    .eq("status", "published")
    .ilike("niche", `%${niche}%`)
    .limit(ANALYTICS_VIDEO_LIMIT)
    .returns<VideoRecord[]>();

  if (videosError || !videos || videos.length === 0) {
    return [
      "Historical performance data is not available yet.",
      "Prioritize a strong 8-second hook, practical examples, and a clear payoff.",
      "Avoid generic advice; make the script specific enough for entrepreneurs to act on immediately.",
    ].join("\n");
  }

  const videoIds = videos.map((video) => video.id);
  const { data: metrics, error: metricsError } = await supabaseAdmin
    .from("video_platform_metrics")
    .select(
      "video_id,platform,views,likes,comments,shares,watch_time_seconds,average_view_duration_seconds"
    )
    .in("video_id", videoIds)
    .limit(ANALYTICS_METRICS_LIMIT)
    .returns<PlatformMetric[]>();

  if (metricsError || !metrics || metrics.length === 0) {
    return [
      "Published videos exist, but platform metrics are not available yet.",
      "Use the same niche, but test a sharper hook and clearer numbered structure.",
      "Keep scene 1 as an 8-second promise, then make each following scene one distinct point.",
    ].join("\n");
  }

  const scoreByVideoId = new Map<string, number>();

  for (const metric of metrics) {
    scoreByVideoId.set(
      metric.video_id,
      (scoreByVideoId.get(metric.video_id) ?? 0) + getMetricScore(metric)
    );
  }

  const rankedVideos = videos
    .map((video) => ({
      title: video.title ?? "Untitled",
      hook: getScriptHook(video.script),
      score: scoreByVideoId.get(video.id) ?? 0,
    }))
    .filter((video) => video.score > 0)
    .sort((a, b) => b.score - a.score);

  return [
    "Use these historical winners as directional guidance. Do not copy them verbatim.",
    formatRankedVideos(rankedVideos),
    "Create a new variation that keeps the strongest hook pattern, but changes the examples and wording.",
    "Optimize for retention: specific promise in scene 1, no filler, one actionable idea per scene.",
  ].join("\n");
}
