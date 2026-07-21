import { supabaseAdmin } from "@/lib/supabase";
import {
  getRenderProgress,
  renderMediaOnLambda,
  type AwsRegion,
} from "@remotion/lambda";

const ASSETS_BUCKET = "short-assets";
const COMPOSITION_ID = "ShortsVideo";
const REMOTION_SERVE_URL_ENV = "REMOTION_SERVE_URL";
const RENDER_PROGRESS_POLL_INTERVAL_MS = 5000;
const RENDER_PROGRESS_MAX_ATTEMPTS = 120;
const RENDER_START_MAX_ATTEMPTS = 4;
const RENDER_START_RETRY_DELAY_MS = 60_000;
const RENDER_JOB_MAX_ATTEMPTS = 3;
const DEFAULT_FRAMES_PER_LAMBDA = 300;
const SUPABASE_UPLOAD_MAX_ATTEMPTS = 4;
const SUPABASE_UPLOAD_RETRY_DELAY_MS = 10_000;
const FPS = 30;

export const REMOTION_OUTPUT_URL_MARKER = "Remotion output URL:";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }

  return value;
}

function getFramesPerLambda(): number {
  const rawValue = process.env.REMOTION_FRAMES_PER_LAMBDA?.trim();

  if (!rawValue) {
    return DEFAULT_FRAMES_PER_LAMBDA;
  }

  const framesPerLambda = Number(rawValue);

  if (!Number.isInteger(framesPerLambda) || framesPerLambda <= 0) {
    throw new Error("REMOTION_FRAMES_PER_LAMBDA must be a positive integer.");
  }

  return framesPerLambda;
}

function getForcedDurationInFrames(inputProps: Record<string, unknown>) {
  const durationValue = inputProps.audioDurationSeconds;
  const durationInSeconds =
    typeof durationValue === "number"
      ? durationValue
      : typeof durationValue === "string"
        ? Number(durationValue)
        : null;

  if (
    !durationInSeconds ||
    !Number.isFinite(durationInSeconds) ||
    durationInSeconds <= 0
  ) {
    return null;
  }

  return Math.max(1, Math.ceil(durationInSeconds * FPS));
}

async function downloadRenderedVideo(outputFile: string): Promise<ArrayBuffer> {
  const response = await fetch(outputFile);

  if (!response.ok) {
    throw new Error(
      `Could not download rendered video: ${response.status} ${response.statusText}`
    );
  }

  return response.arrayBuffer();
}

async function uploadRenderedVideo(
  videoId: string,
  videoBuffer: ArrayBuffer
): Promise<string> {
  const videoPath = `videos/${videoId}.mp4`;

  for (
    let attempt = 1;
    attempt <= SUPABASE_UPLOAD_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const { error } = await supabaseAdmin.storage
      .from(ASSETS_BUCKET)
      .upload(videoPath, videoBuffer, {
        contentType: "video/mp4",
        upsert: true,
      });

    if (!error) {
      const { data } = supabaseAdmin.storage
        .from(ASSETS_BUCKET)
        .getPublicUrl(videoPath);

      return data.publicUrl;
    }

    if (attempt === SUPABASE_UPLOAD_MAX_ATTEMPTS) {
      throw new Error(
        `Supabase upload failed for ${videoPath}: ${error.message}`
      );
    }

    const waitMs = SUPABASE_UPLOAD_RETRY_DELAY_MS * attempt;

    console.warn("Supabase rendered video upload failed, retrying", {
      attempt,
      waitMs,
      videoPath,
      error: error.message,
    });

    await sleep(waitMs);
  }

  throw new Error(`Supabase upload failed for ${videoPath}.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientLambdaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("AWS Concurrency limit reached") ||
    message.includes("Rate Exceeded") ||
    message.includes("TooManyRequests") ||
    message.includes("Throttl") ||
    message.includes("429") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  );
}

async function startRenderOnLambda({
  functionName,
  framesPerLambda,
  inputProps,
  region,
  serveUrl,
}: {
  functionName: string;
  framesPerLambda: number;
  inputProps: Record<string, unknown>;
  region: AwsRegion;
  serveUrl: string;
}) {
  const forceDurationInFrames = getForcedDurationInFrames(inputProps);

  for (let attempt = 1; attempt <= RENDER_START_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await renderMediaOnLambda({
        codec: "h264",
        composition: COMPOSITION_ID,
        framesPerLambda,
        forceDurationInFrames,
        functionName,
        inputProps,
        region,
        serveUrl,
        privacy: "public",
        downloadBehavior: {
          type: "play-in-browser",
        },
      });
    } catch (error) {
      if (
        !isTransientLambdaError(error) ||
        attempt === RENDER_START_MAX_ATTEMPTS
      ) {
        throw error;
      }

      const waitMs = RENDER_START_RETRY_DELAY_MS * attempt;

      console.warn("Remotion Lambda render start failed, retrying", {
        attempt,
        waitMs,
        error: error instanceof Error ? error.message : String(error),
      });

      await sleep(waitMs);
    }
  }

  throw new Error("Remotion Lambda render could not be started.");
}

export async function renderVideoOnLambda(
  videoId: string,
  inputProps: Record<string, unknown>
): Promise<string> {
  try {
    requireEnv("AWS_ACCESS_KEY_ID");
    requireEnv("AWS_SECRET_ACCESS_KEY");

    const region = requireEnv("REMOTION_AWS_REGION") as AwsRegion;
    const functionName = requireEnv("REMOTION_AWS_FUNCTION_NAME");
    const serveUrl = requireEnv(REMOTION_SERVE_URL_ENV);
    const framesPerLambda = getFramesPerLambda();
    const forceDurationInFrames = getForcedDurationInFrames(inputProps);

    console.log("Starting Remotion Lambda render", {
      videoId,
      framesPerLambda,
      forceDurationInFrames,
      audioDurationSeconds: inputProps.audioDurationSeconds,
      region,
      functionName,
    });

    for (
      let renderAttempt = 1;
      renderAttempt <= RENDER_JOB_MAX_ATTEMPTS;
      renderAttempt += 1
    ) {
      const render = await startRenderOnLambda({
        framesPerLambda,
        functionName,
        inputProps,
        region,
        serveUrl,
      });
      let shouldStartNewRender = false;

      for (
        let attempt = 0;
        attempt < RENDER_PROGRESS_MAX_ATTEMPTS;
        attempt += 1
      ) {
        let progress;

        try {
          progress = await getRenderProgress({
            bucketName: render.bucketName,
            functionName,
            region,
            renderId: render.renderId,
          });
        } catch (error) {
          if (!isTransientLambdaError(error)) {
            throw error;
          }

          console.warn("Remotion Lambda progress check failed, retrying", {
            attempt: attempt + 1,
            error: error instanceof Error ? error.message : String(error),
          });

          await sleep(RENDER_PROGRESS_POLL_INTERVAL_MS);
          continue;
        }

        if (progress.fatalErrorEncountered || progress.errors.length > 0) {
          const errorMessage =
            progress.errors[0]?.message ??
            "Unknown Remotion Lambda render error.";

          if (
            isTransientLambdaError(errorMessage) &&
            renderAttempt < RENDER_JOB_MAX_ATTEMPTS
          ) {
            const waitMs = RENDER_START_RETRY_DELAY_MS * renderAttempt;

            console.warn("Remotion Lambda render failed, starting a new render", {
              renderAttempt,
              waitMs,
              error: errorMessage,
            });

            shouldStartNewRender = true;
            await sleep(waitMs);
            break;
          }

          throw new Error(errorMessage);
        }

        if (progress.done) {
          if (!progress.outputFile) {
            throw new Error("Remotion render completed without an output file.");
          }

          const videoBuffer = await downloadRenderedVideo(progress.outputFile);

          try {
            return await uploadRenderedVideo(videoId, videoBuffer);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            throw new Error(
              `${message} ${REMOTION_OUTPUT_URL_MARKER} ${progress.outputFile}`
            );
          }
        }

        await sleep(RENDER_PROGRESS_POLL_INTERVAL_MS);
      }

      if (!shouldStartNewRender) {
        throw new Error("Remotion render timed out while waiting for completion.");
      }
    }

    throw new Error("Remotion render failed after retrying new render jobs.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Lambda video render failed: ${message}`);
  }
}

export async function uploadExistingRenderedVideo(
  videoId: string,
  outputFile: string
): Promise<string> {
  const videoBuffer = await downloadRenderedVideo(outputFile);

  return uploadRenderedVideo(videoId, videoBuffer);
}
