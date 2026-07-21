import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY?.trim() || "placeholder-openai-api-key",
});

export type GeneratedScene = {
  id: number;
  subtitle: string;
  visual_prompt: string;
  duration_seconds: number;
};

export type GeneratedScript = {
  title: string;
  description: string;
  voice_over: string;
  scenes: GeneratedScene[];
};

export async function generateScript(
  niche: string,
  strategyContext?: string
): Promise<GeneratedScript> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'You are a short-form video script generator for English-speaking Shorts audiences. Return only valid JSON with this exact schema: { "title": "video_title", "description": "short punchy social media caption with hashtags", "voice_over": "exactly 60 seconds of fast-paced continuous English voice-over text", "scenes": [{ "id": 1, "subtitle": "short English on-screen subtitle", "visual_prompt": "English cinematic visual prompt for Flux", "duration_seconds": 8 }] }. Create a complete 60-second Shorts script with a strong hook, fast pacing, no slow introduction, no filler, and steady momentum until the final line. The description must be 1 to 2 short English sentences plus 3 to 5 relevant hashtags, under 260 characters total, curiosity-driven, platform-safe, and written as a compelling summary or caption, not a transcript. Use niche-specific hashtags and include at least one broad discovery hashtag such as #Shorts, #Reels, or #TikTok. Do not copy the voice_over into description. Scene 1 is always the hook and must last exactly 8 seconds in the voice_over. After the hook, create 7 to 11 additional scenes that follow the voice_over chronology exactly. The remaining 52 seconds of voice_over must be divided as evenly as possible across those non-hook scenes. Set each scene.duration_seconds to its planned spoken duration, and make all scene durations sum to exactly 60. Each subtitle and visual_prompt must match the exact narration segment for that scene. Every generated value must be in English and must target English-speaking viewers.',
      },
      {
        role: "user",
        content: [
          `Niche: ${niche}`,
          strategyContext
            ? `Historical performance and strategy context:\n${strategyContext}`
            : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  const content = completion.choices[0]?.message.content;

  if (!content) {
    throw new Error("OpenAI returned an empty script response.");
  }

  return JSON.parse(content) as GeneratedScript;
}
