import { getAudioDurationInSeconds } from "@remotion/media-utils";
import React from "react";
import { Composition, registerRoot } from "remotion";
import { ShortsVideo } from "./ShortsVideo";

const ShortsVideoComponent = ShortsVideo as React.FC<Record<string, unknown>>;
const FPS = 30;
const DEFAULT_DURATION_IN_FRAMES = 1800;

function getDurationInFramesFromSeconds(durationInSeconds: unknown) {
  const duration =
    typeof durationInSeconds === "number"
      ? durationInSeconds
      : typeof durationInSeconds === "string"
        ? Number(durationInSeconds)
        : null;

  if (!duration || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(duration * FPS));
}

async function getDurationInFrames({
  audioDurationSeconds,
  audioUrl,
}: {
  audioDurationSeconds: unknown;
  audioUrl: unknown;
}) {
  const durationFromProps = getDurationInFramesFromSeconds(
    audioDurationSeconds
  );

  if (durationFromProps) {
    return durationFromProps;
  }

  if (typeof audioUrl !== "string" || audioUrl.length === 0) {
    return DEFAULT_DURATION_IN_FRAMES;
  }

  try {
    const audioDurationInSeconds = await getAudioDurationInSeconds(audioUrl);

    return Math.max(1, Math.ceil(audioDurationInSeconds * FPS));
  } catch (error) {
    console.warn("Could not calculate audio duration, using default duration", {
      audioUrl,
      error: error instanceof Error ? error.message : String(error),
    });

    return DEFAULT_DURATION_IN_FRAMES;
  }
}

const RemotionRoot = () => {
  return React.createElement(Composition, {
    id: "ShortsVideo",
    component: ShortsVideoComponent,
    durationInFrames: DEFAULT_DURATION_IN_FRAMES,
    fps: FPS,
    width: 1080,
    height: 1920,
    calculateMetadata: async ({ props }: { props: Record<string, unknown> }) => {
      return {
        durationInFrames: await getDurationInFrames({
          audioDurationSeconds: props.audioDurationSeconds,
          audioUrl: props.audioUrl,
        }),
      };
    },
    defaultProps: {
      audioDurationSeconds: null,
      audioUrl: "",
      backgroundMusicUrl: null,
      images: [],
      musicVolume: 0.1,
      scenes: [],
    },
  });
};

registerRoot(RemotionRoot);
