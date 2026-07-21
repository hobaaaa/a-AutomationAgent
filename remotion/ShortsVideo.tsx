import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type ShortsScene = {
  id: number;
  subtitle?: string;
  visual_prompt?: string;
  duration_seconds?: number;
};

export type ShortsVideoProps = {
  audioDurationSeconds?: number | null;
  audioUrl: string;
  images: string[];
  musicVolume?: number;
  backgroundMusicUrl?: string | null;
  scenes: ShortsScene[];
};

const FALLBACK_HOOK_DURATION_SECONDS = 8;
const DEFAULT_MUSIC_VOLUME = 0.1;

function getSceneDurations({
  imageCount,
  scenes,
}: {
  imageCount: number;
  scenes: ShortsScene[];
}) {
  const sceneDurations = scenes
    .slice(0, imageCount)
    .map((scene) => scene.duration_seconds ?? 0);
  const hasValidDurations =
    sceneDurations.length === imageCount &&
    sceneDurations.every((duration) => duration > 0);

  if (hasValidDurations) {
    return sceneDurations;
  }

  if (imageCount <= 1) {
    return [1];
  }

  const remainingDuration = Math.max(1, 60 - FALLBACK_HOOK_DURATION_SECONDS);
  const remainingSceneDuration = remainingDuration / (imageCount - 1);

  return [
    FALLBACK_HOOK_DURATION_SECONDS,
    ...Array.from({ length: imageCount - 1 }, () => remainingSceneDuration),
  ];
}

function getActiveSceneIndex({
  durationInFrames,
  frame,
  imageCount,
  scenes,
}: {
  durationInFrames: number;
  frame: number;
  imageCount: number;
  scenes: ShortsScene[];
}) {
  const sceneDurations = getSceneDurations({ imageCount, scenes });
  const totalDuration = sceneDurations.reduce((sum, duration) => sum + duration, 0);
  const normalizedFrame = frame / Math.max(durationInFrames, 1);
  const currentDuration = normalizedFrame * totalDuration;
  let elapsedDuration = 0;

  for (let index = 0; index < sceneDurations.length; index += 1) {
    elapsedDuration += sceneDurations[index];

    if (currentDuration < elapsedDuration) {
      return index;
    }
  }

  return imageCount - 1;
}

function getSceneStartFrame({
  activeIndex,
  durationInFrames,
  imageCount,
  scenes,
}: {
  activeIndex: number;
  durationInFrames: number;
  imageCount: number;
  scenes: ShortsScene[];
}) {
  const sceneDurations = getSceneDurations({ imageCount, scenes });
  const totalDuration = sceneDurations.reduce((sum, duration) => sum + duration, 0);
  const elapsedDuration = sceneDurations
    .slice(0, activeIndex)
    .reduce((sum, duration) => sum + duration, 0);

  return (elapsedDuration / totalDuration) * durationInFrames;
}

function getSceneFrameDuration({
  activeIndex,
  durationInFrames,
  imageCount,
  scenes,
}: {
  activeIndex: number;
  durationInFrames: number;
  imageCount: number;
  scenes: ShortsScene[];
}) {
  const sceneDurations = getSceneDurations({ imageCount, scenes });
  const totalDuration = sceneDurations.reduce((sum, duration) => sum + duration, 0);

  return (sceneDurations[activeIndex] / totalDuration) * durationInFrames;
}

export const ShortsVideo = ({
  audioUrl,
  backgroundMusicUrl,
  images,
  musicVolume = DEFAULT_MUSIC_VOLUME,
  scenes,
}: ShortsVideoProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const imageCount = Math.max(images.length, 1);
  const activeIndex = Math.min(
    images.length - 1,
    getActiveSceneIndex({ durationInFrames, frame, imageCount, scenes })
  );
  const activeImage = images[activeIndex];
  const activeScene = scenes[activeIndex];
  const sceneStartFrame = getSceneStartFrame({
    activeIndex,
    durationInFrames,
    imageCount,
    scenes,
  });
  const sceneFrameDuration = getSceneFrameDuration({
    activeIndex,
    durationInFrames,
    imageCount,
    scenes,
  });
  const localFrame = frame - sceneStartFrame;
  const scale = interpolate(localFrame, [0, sceneFrameDuration], [1, 1.08], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const panX = interpolate(
    localFrame,
    [0, sceneFrameDuration],
    [activeIndex % 2 === 0 ? -2 : 2, activeIndex % 2 === 0 ? 2 : -2],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );
  const panY = interpolate(
    localFrame,
    [0, sceneFrameDuration],
    [activeIndex % 3 === 0 ? -1.5 : 1.5, activeIndex % 3 === 0 ? 1.5 : -1.5],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );
  const sceneFlashOpacity = interpolate(localFrame, [0, 4, 10], [0.16, 0.06, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <Audio src={audioUrl} />
      {backgroundMusicUrl ? (
        <Audio src={backgroundMusicUrl} volume={musicVolume} />
      ) : null}

      {activeImage ? (
        <Img
          src={activeImage}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale}) translate3d(${panX}%, ${panY}%, 0)`,
          }}
        />
      ) : null}

      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.2), rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.35))",
        }}
      />

      <AbsoluteFill
        style={{
          backgroundColor: "#facc15",
          mixBlendMode: "screen",
          opacity: sceneFlashOpacity,
        }}
      />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: 96,
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: "#facc15",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 86,
            fontWeight: 900,
            lineHeight: 1.08,
            textShadow:
              "0 6px 0 #000, 0 12px 28px rgba(0, 0, 0, 0.9), 0 0 8px rgba(0, 0, 0, 0.9)",
            textTransform: "uppercase",
          }}
        >
          {activeScene?.subtitle ?? ""}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
