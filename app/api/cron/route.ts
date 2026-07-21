import { getStrategyContext } from "@/agents/analyticsAgent";
import {
  generateImages,
  generateSpeech,
  getAudioDurationFromUrl,
  isAudioUrlAvailable,
} from "@/agents/mediaAgent";
import { sendToPublishWebhook } from "@/agents/publishAgent";
import {
  REMOTION_OUTPUT_URL_MARKER,
  renderVideoOnLambda,
  uploadExistingRenderedVideo,
} from "@/agents/renderAgent";
import {
  generateScript,
  type GeneratedScript,
} from "@/agents/scriptAgent";
import {
  assertSupabaseAdminEnv,
  assertSupabaseReachable,
  getSupabaseHost,
  supabaseAdmin,
} from "@/lib/supabase";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type VideoJob = {
  id: string;
  channel_key?: string | null;
  channel_name?: string | null;
  niche: string;
  retry_count: number | null;
  title?: string | null;
  description?: string | null;
  script?: unknown;
  voice_url?: string | null;
  audio_duration_seconds?: number | string | null;
  media_urls?: unknown;
  final_video_url?: string | null;
  scheduled_at?: string | null;
  error_message?: string | null;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCronAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return true;
  }

  return (
    request.headers.get("x-cron-secret") === cronSecret ||
    request.headers.get("authorization") === `Bearer ${cronSecret}`
  );
}

function logCronStage(stage: string, details?: Record<string, unknown>) {
  console.log("[cron]", {
    stage,
    ...details,
  });
}

function isGeneratedScript(value: unknown): value is GeneratedScript {
  if (!value || typeof value !== "object") {
    return false;
  }

  const script = value as Partial<GeneratedScript>;

  return (
    typeof script.title === "string" &&
    typeof script.voice_over === "string" &&
    Array.isArray(script.scenes)
  );
}

function getPublishDescription({
  script,
  storedDescription,
  niche,
}: {
  script: GeneratedScript;
  storedDescription?: string | null;
  niche: string;
}) {
  if (storedDescription && storedDescription.trim().length > 0) {
    return storedDescription.trim();
  }

  if (script.description && script.description.trim().length > 0) {
    return script.description.trim();
  }

  return `${script.title} A quick, useful breakdown for viewers interested in ${niche}.`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function getValidDurationSeconds(value: unknown): number | null {
  const duration =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : null;

  if (!duration || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  return duration;
}

function getOptionalNumberEnv({
  defaultValue,
  max,
  min,
  name,
}: {
  defaultValue: number;
  max: number;
  min: number;
  name: string;
}) {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}.`);
  }

  return value;
}

function getExistingRemotionOutputUrl(errorMessage?: string | null) {
  if (!errorMessage) {
    return null;
  }

  const markerIndex = errorMessage.indexOf(REMOTION_OUTPUT_URL_MARKER);

  if (markerIndex === -1) {
    return null;
  }

  const outputUrl = errorMessage
    .slice(markerIndex + REMOTION_OUTPUT_URL_MARKER.length)
    .trim();

  return outputUrl.length > 0 ? outputUrl : null;
}

async function updateVideo(videoId: string, values: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from("videos")
    .update(values)
    .eq("id", videoId);

  if (error) {
    throw new Error(`Video update failed: ${error.message}`);
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  let video: VideoJob | null = null;
  let stage = "initializing";

  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    logCronStage(stage, { path: requestUrl.pathname });

    stage = "checking_environment";
    assertSupabaseAdminEnv();
    logCronStage(stage, { supabaseHost: getSupabaseHost() });

    stage = "checking_supabase_connection";
    logCronStage(stage, { supabaseHost: getSupabaseHost() });
    await assertSupabaseReachable();

    stage = "fetching_pending_video";
    logCronStage(stage);

    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("videos")
      .select("*")
      .in("status", ["pending", "failed"])
      .lt("retry_count", 3)
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
      .order("scheduled_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<VideoJob>();

    if (error) {
      throw new Error(`Processable video query failed: ${error.message}`);
    }

    if (!data) {
      logCronStage("no_pending_video");

      return NextResponse.json({
        message: "No due pending videos.",
        stage: "no_due_pending_video",
      });
    }

    video = data;
    const videoId = video.id;
    let scriptJSON: GeneratedScript;
    let audioUrl: string;
    let audioDurationSeconds: number | null = null;
    let imageUrls: string[];
    let mp4Url: string;

    if (isGeneratedScript(video.script)) {
      scriptJSON = video.script;
      logCronStage("using_existing_script", { videoId });
    } else {
      stage = "generating_script";
      logCronStage(stage, {
        videoId,
        channelKey: video.channel_key ?? null,
        scheduledAt: video.scheduled_at ?? null,
        niche: video.niche,
      });

      const strategyContext = await getStrategyContext(video.niche);
      scriptJSON = await generateScript(video.niche, strategyContext);

      stage = "saving_script";
      logCronStage(stage, { videoId });

      await updateVideo(videoId, {
        status: "script_ready",
        title: scriptJSON.title,
        description: scriptJSON.description,
        script: scriptJSON,
      });
    }

    if (video.voice_url) {
      audioUrl = video.voice_url;
      audioDurationSeconds = getValidDurationSeconds(
        video.audio_duration_seconds
      );
      const audioAvailable = await isAudioUrlAvailable(audioUrl);

      if (audioAvailable && audioDurationSeconds) {
        logCronStage("using_existing_speech", {
          videoId,
          audioDurationSeconds,
        });
      } else if (audioAvailable) {
        stage = "measuring_existing_speech";
        logCronStage(stage, { videoId });

        audioDurationSeconds = await getAudioDurationFromUrl(audioUrl);

        await updateVideo(videoId, {
          audio_duration_seconds: audioDurationSeconds,
        });
      } else {
        stage = "regenerating_missing_speech";
        logCronStage(stage, { videoId, audioUrl });

        const speech = await generateSpeech(scriptJSON.voice_over, videoId);
        audioUrl = speech.audioUrl;
        audioDurationSeconds = speech.audioDurationSeconds;

        await updateVideo(videoId, {
          voice_url: audioUrl,
          audio_duration_seconds: audioDurationSeconds,
        });
      }
    } else {
      stage = "generating_speech";
      logCronStage(stage, { videoId });

      const speech = await generateSpeech(scriptJSON.voice_over, videoId);
      audioUrl = speech.audioUrl;
      audioDurationSeconds = speech.audioDurationSeconds;

      stage = "saving_speech";
      logCronStage(stage, { videoId, audioDurationSeconds });

      await updateVideo(videoId, {
        voice_url: audioUrl,
        audio_duration_seconds: audioDurationSeconds,
      });
    }

    if (isStringArray(video.media_urls) && video.media_urls.length > 0) {
      imageUrls = video.media_urls;
      logCronStage("using_existing_images", {
        videoId,
        imageCount: imageUrls.length,
      });
    } else {
      stage = "generating_images";
      logCronStage(stage, { videoId, sceneCount: scriptJSON.scenes.length });

      imageUrls = await generateImages(scriptJSON.scenes, videoId);

      stage = "saving_media";
      logCronStage(stage, { videoId, imageCount: imageUrls.length });

      await updateVideo(videoId, {
        status: "media_ready",
        voice_url: audioUrl,
        audio_duration_seconds: audioDurationSeconds,
        media_urls: imageUrls,
      });
    }

    if (video.final_video_url) {
      mp4Url = video.final_video_url;
      logCronStage("using_existing_render", { videoId, videoUrl: mp4Url });
    } else {
      const existingRemotionOutputUrl = getExistingRemotionOutputUrl(
        video.error_message
      );

      if (existingRemotionOutputUrl) {
        stage = "uploading_existing_render";
        logCronStage(stage, { videoId });

        mp4Url = await uploadExistingRenderedVideo(
          videoId,
          existingRemotionOutputUrl
        );
      } else {
        stage = "rendering_video";
        logCronStage(stage, { videoId });

        mp4Url = await renderVideoOnLambda(videoId, {
          audioUrl,
          audioDurationSeconds,
          backgroundMusicUrl:
            process.env.BACKGROUND_MUSIC_URL?.trim() || null,
          images: imageUrls,
          musicVolume: getOptionalNumberEnv({
            defaultValue: 0.1,
            max: 1,
            min: 0,
            name: "BACKGROUND_MUSIC_VOLUME",
          }),
          scenes: scriptJSON.scenes,
        });
      }

      stage = "saving_render";
      logCronStage(stage, { videoId });

      await updateVideo(videoId, {
        status: "rendered",
        final_video_url: mp4Url,
      });
    }

    stage = "publishing_video";
    logCronStage(stage, { videoId });

    const publishSuccess = await sendToPublishWebhook(
      videoId,
      mp4Url,
      scriptJSON.title,
      getPublishDescription({
        script: scriptJSON,
        storedDescription: video.description,
        niche: video.niche,
      }),
      {
        key: video.channel_key ?? null,
        name: video.channel_name ?? null,
        niche: video.niche,
      }
    );

    if (!publishSuccess) {
      throw new Error("Publish webhook returned an unsuccessful result.");
    }

    stage = "marking_published";
    logCronStage(stage, { videoId });

    await updateVideo(videoId, {
      status: "published",
    });

    logCronStage("completed", { videoId, videoUrl: mp4Url });

    return NextResponse.json({
      message: "Video was generated successfully and sent to the publishing queue.",
      stage: "completed",
      videoId,
      videoUrl: mp4Url,
      channelKey: video.channel_key ?? null,
      scheduledAt: video.scheduled_at ?? null,
      path: requestUrl.pathname,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);

    if (video?.id) {
      const retryCount = (video.retry_count ?? 0) + 1;

      const { error: updateError } = await supabaseAdmin
        .from("videos")
        .update({
          status: "failed",
          error_message: errorMessage,
          retry_count: retryCount,
        })
        .eq("id", video.id);

      if (updateError) {
        console.error("Failed to mark video as failed", updateError);
      }
    }

    console.error("[cron] failed", {
      stage,
      videoId: video?.id ?? null,
      error: errorMessage,
      rawError: error,
    });

    return NextResponse.json(
      {
        message: "An error occurred while processing the video.",
        stage,
        error: errorMessage,
        videoId: video?.id ?? null,
      },
      { status: 500 }
    );
  }
}
