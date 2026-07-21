export async function sendToPublishWebhook(
  videoId: string,
  videoUrl: string,
  title: string,
  description: string,
  channel: {
    key: string | null;
    name: string | null;
    niche: string;
  }
): Promise<boolean> {
  try {
    const webhookUrl = process.env.MAKE_PUBLISH_WEBHOOK_URL;

    if (!webhookUrl) {
      throw new Error("Missing MAKE_PUBLISH_WEBHOOK_URL environment variable.");
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        videoId,
        videoUrl,
        title,
        description,
        channelKey: channel.key,
        channelName: channel.name,
        niche: channel.niche,
        platforms: ["youtube", "instagram", "tiktok"],
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();

      console.error("Make publish webhook failed", {
        status: response.status,
        statusText: response.statusText,
        responseText,
      });

      return false;
    }

    return true;
  } catch (error) {
    console.error("Could not send video to Make publish webhook", error);

    return false;
  }
}
