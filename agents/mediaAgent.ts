import { supabaseAdmin } from "@/lib/supabase";
import { parseMedia } from "@remotion/media-parser";
import OpenAI from "openai";
import Replicate from "replicate";

const ASSETS_BUCKET = "short-assets";
const DEFAULT_REPLICATE_IMAGE_MODEL =
  "black-forest-labs/flux-schnell:c846a69991daf4c0e5d016514849d14ee5b2e6846ce6b9d6f21369e564cfe51e";
const REPLICATE_PREDICTION_DELAY_MS = 11_000;
const REPLICATE_MAX_ATTEMPTS = 3;
const DEFAULT_TTS_SPEED = 0.88;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY?.trim() || "placeholder-openai-api-key",
});

const replicate = new Replicate({
  auth:
    process.env.REPLICATE_API_TOKEN?.trim() ||
    "placeholder-replicate-api-token",
  useFileOutput: false,
});

type VisualScene = {
  id: number;
  visual_prompt: string;
};

type ReplicateModelIdentifier = `${string}/${string}` | `${string}/${string}:${string}`;

export type GeneratedSpeech = {
  audioUrl: string;
  audioDurationSeconds: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getRetryAfterMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const retryAfterMatch = message.match(/"retry_after"\s*:\s*(\d+)/);

  if (!retryAfterMatch) {
    return null;
  }

  return Number(retryAfterMatch[1]) * 1000;
}

function getTtsSpeed(): number {
  const rawValue = process.env.TTS_SPEED?.trim();

  if (!rawValue) {
    return DEFAULT_TTS_SPEED;
  }

  const speed = Number(rawValue);

  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error("TTS_SPEED must be a number between 0.25 and 4.");
  }

  return speed;
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return message.includes("429") || message.includes("rate limit");
}

function getReplicateImageModel(): ReplicateModelIdentifier {
  const model =
    process.env.REPLICATE_IMAGE_MODEL?.trim() ||
    DEFAULT_REPLICATE_IMAGE_MODEL;

  if (!model.includes("/")) {
    throw new Error("REPLICATE_IMAGE_MODEL must use owner/model or owner/model:version format.");
  }

  return model as ReplicateModelIdentifier;
}

function isTransientReplicateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    isRateLimitError(error) ||
    message.includes("Prediction failed") ||
    message.includes("unexpected error handling prediction") ||
    message.includes("E9828") ||
    message.includes("No adapter found for model") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  );
}

function getReplicateImageUrl(output: unknown): string {
  const firstOutput = Array.isArray(output) ? output[0] : output;

  if (typeof firstOutput === "string") {
    return firstOutput;
  }

  if (firstOutput instanceof URL) {
    return firstOutput.toString();
  }

  if (firstOutput && typeof firstOutput === "object" && "url" in firstOutput) {
    const urlValue = firstOutput.url;

    if (typeof urlValue === "string") {
      return urlValue;
    }

    if (typeof urlValue === "function") {
      return String(urlValue());
    }
  }

  throw new Error("Replicate did not return a valid image URL.");
}

async function uploadAsset(
  path: string,
  fileBody: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const { error } = await supabaseAdmin.storage
    .from(ASSETS_BUCKET)
    .upload(path, fileBody, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Supabase upload failed for ${path}: ${error.message}`);
  }

  const { data } = supabaseAdmin.storage.from(ASSETS_BUCKET).getPublicUrl(path);

  return data.publicUrl;
}

async function getAudioDurationFromBuffer(
  audioBuffer: ArrayBuffer,
): Promise<number> {
  const result = await parseMedia({
    src: new Blob([audioBuffer], { type: "audio/mpeg" }),
    fields: {
      durationInSeconds: true,
    },
    acknowledgeRemotionLicense: true,
    logLevel: "error",
  });

  if (
    typeof result.durationInSeconds !== "number" ||
    !Number.isFinite(result.durationInSeconds) ||
    result.durationInSeconds <= 0
  ) {
    throw new Error("Could not calculate generated audio duration.");
  }

  return Number(result.durationInSeconds.toFixed(3));
}

export async function getAudioDurationFromUrl(
  audioUrl: string,
): Promise<number> {
  const response = await fetch(audioUrl);

  if (!response.ok) {
    throw new Error(
      `Could not download audio for duration check: ${response.status} ${response.statusText}`,
    );
  }

  const audioBuffer = await response.arrayBuffer();

  return getAudioDurationFromBuffer(audioBuffer);
}

export async function isAudioUrlAvailable(audioUrl: string): Promise<boolean> {
  try {
    const response = await fetch(audioUrl, { method: "HEAD" });

    if (response.ok) {
      return true;
    }

    const fallbackResponse = await fetch(audioUrl, {
      headers: {
        Range: "bytes=0-0",
      },
    });

    return fallbackResponse.ok;
  } catch {
    return false;
  }
}

async function runReplicateImagePrediction(scene: VisualScene) {
  const model = getReplicateImageModel();

  for (let attempt = 1; attempt <= REPLICATE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await replicate.run(model, {
        input: {
          prompt: scene.visual_prompt,
          go_fast: true,
          num_outputs: 1,
          num_inference_steps: 4,
          aspect_ratio: "9:16",
          output_format: "jpg",
          output_quality: 90,
        },
      });
    } catch (error) {
      if (
        !isTransientReplicateError(error) ||
        attempt === REPLICATE_MAX_ATTEMPTS
      ) {
        throw error;
      }

      const retryAfterMs = getRetryAfterMs(error);
      const waitMs = Math.max(
        retryAfterMs ?? 0,
        REPLICATE_PREDICTION_DELAY_MS * attempt,
      );

      console.warn("Replicate image generation failed, retrying", {
        sceneId: scene.id,
        model,
        attempt,
        waitMs,
      });

      await sleep(waitMs);
    }
  }

  throw new Error(`Replicate image generation failed for scene ${scene.id}.`);
}

export async function generateSpeech(
  text: string,
  videoId: string,
): Promise<GeneratedSpeech> {
  try {
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "echo",
      input: text,
      instructions:
        "Use a high-energy English Shorts creator voice: upbeat, confident, punchy, and expressive. Keep strong momentum, emphasize key words naturally, and avoid sounding calm, sleepy, monotone, or rushed.",
      response_format: "mp3",
      speed: getTtsSpeed(),
    });

    const audioBuffer = await speech.arrayBuffer();
    const audioDurationSeconds = await getAudioDurationFromBuffer(audioBuffer);
    const audioPath = `audio/${videoId}.mp3`;
    const audioUrl = await uploadAsset(audioPath, audioBuffer, "audio/mpeg");

    return {
      audioUrl,
      audioDurationSeconds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Speech generation failed: ${message}`);
  }
}

export async function generateImages(
  scenes: VisualScene[],
  videoId: string,
): Promise<string[]> {
  try {
    const imageUrls: string[] = [];

    for (const [index, scene] of scenes.entries()) {
      if (index > 0) {
        await sleep(REPLICATE_PREDICTION_DELAY_MS);
      }

      const output = await runReplicateImagePrediction(scene);

      const imageUrl = getReplicateImageUrl(output);
      const imageResponse = await fetch(imageUrl);

      if (!imageResponse.ok) {
        throw new Error(
          `Could not download generated image for scene ${scene.id}: ${imageResponse.status} ${imageResponse.statusText}`,
        );
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const imagePath = `images/${videoId}/${scene.id}.jpg`;
      const publicUrl = await uploadAsset(imagePath, imageBuffer, "image/jpeg");

      imageUrls.push(publicUrl);
    }

    return imageUrls;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Image generation failed: ${message}`);
  }
}
