export type ChannelConfig = {
  key: string;
  name: string;
  niche: string;
};

const DEFAULT_CHANNELS: ChannelConfig[] = [
  {
    key: "history",
    name: "History",
    niche: "History mysteries, forgotten events, and surprising facts",
  },
  {
    key: "finance",
    name: "Finance",
    niche: "Personal finance, money psychology, and business lessons",
  },
  {
    key: "ai_tech",
    name: "AI Technology",
    niche: "AI tools, automation, and technology trends",
  },
];

function isValidChannelConfig(value: unknown): value is ChannelConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const channel = value as Partial<ChannelConfig>;

  return (
    typeof channel.key === "string" &&
    channel.key.trim().length > 0 &&
    typeof channel.name === "string" &&
    channel.name.trim().length > 0 &&
    typeof channel.niche === "string" &&
    channel.niche.trim().length > 0
  );
}

export function getDailyChannels(): ChannelConfig[] {
  const rawValue = process.env.DAILY_CHANNELS_JSON;

  if (!rawValue) {
    return DEFAULT_CHANNELS;
  }

  const parsed = JSON.parse(rawValue) as unknown;

  if (!Array.isArray(parsed) || !parsed.every(isValidChannelConfig)) {
    throw new Error(
      "DAILY_CHANNELS_JSON must be a JSON array of { key, name, niche } objects.",
    );
  }

  const keys = new Set<string>();

  return parsed.map((channel) => {
    const key = channel.key.trim();

    if (keys.has(key)) {
      throw new Error(`DAILY_CHANNELS_JSON contains duplicate key: ${key}`);
    }

    keys.add(key);

    return {
      key,
      name: channel.name.trim(),
      niche: channel.niche.trim(),
    };
  });
}
