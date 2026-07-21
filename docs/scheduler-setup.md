# Scheduler Setup

This project should not use Vercel Hobby cron for video processing because full video generation can exceed the serverless function timeout. It should also not rely on GitHub Actions `schedule` as the primary trigger because scheduled runs can be delayed or skipped.

Use an external cron service to trigger the workflows with GitHub's `workflow_dispatch` API.

## Required GitHub Token

Create a fine-grained GitHub personal access token for this repo:

- Repository: `hobaaaa/a-AutomationAgent`
- Contents: Read
- Actions: Read and write

Save the token only inside the external cron service. Do not commit it to the repo.

## Daily Seed Job

Run this once per day before the first publishing slot.

For the normal US schedule, use `America/New_York` and seed before 11:00 New York time.

Request:

```http
POST https://api.github.com/repos/hobaaaa/a-AutomationAgent/actions/workflows/seed-daily-videos.yml/dispatches
Authorization: Bearer YOUR_GITHUB_TOKEN
Accept: application/vnd.github+json
Content-Type: application/json

{"ref":"main"}
```

The seed workflow calls `/api/cron/seed` and creates one pending row per channel in Supabase.

## Process Due Video Job

Run this every 5 minutes. It processes only one due video per run.

Request:

```http
POST https://api.github.com/repos/hobaaaa/a-AutomationAgent/actions/workflows/process-due-video.yml/dispatches
Authorization: Bearer YOUR_GITHUB_TOKEN
Accept: application/vnd.github+json
Content-Type: application/json

{"ref":"main"}
```

The process workflow starts the app inside GitHub Actions and calls the local `/api/cron` endpoint. This avoids Vercel function timeout during rendering.

## GitHub Secrets

Add every runtime variable used for generation and publishing to GitHub repository secrets:

- `APP_BASE_URL`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `CRON_SECRET`
- `DAILY_CHANNELS_JSON` if overriding default channels
- `DAILY_CHANNEL_SPACING_MINUTES`
- `DAILY_FIRST_RUN_HOUR_LOCAL`
- `DAILY_FIRST_RUN_MINUTE_LOCAL`
- `DAILY_SCHEDULE_TIME_ZONE`
- `MAKE_PUBLISH_WEBHOOK_URL`
- `METRICS_INGEST_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`
- `OPENAI_API_KEY`
- `REMOTION_AWS_FUNCTION_NAME`
- `REMOTION_AWS_REGION`
- `REMOTION_FRAMES_PER_LAMBDA`
- `REMOTION_SERVE_URL`
- `REPLICATE_API_TOKEN`
- `REPLICATE_IMAGE_MODEL` optional; defaults to the pinned Flux Schnell version
- `SUPABASE_SERVICE_ROLE_KEY`
- `TTS_SPEED`

For the normal publishing cadence:

```text
DAILY_SCHEDULE_TIME_ZONE=America/New_York
DAILY_FIRST_RUN_HOUR_LOCAL=11
DAILY_FIRST_RUN_MINUTE_LOCAL=0
DAILY_CHANNEL_SPACING_MINUTES=0
```

This creates three daily videos scheduled for the same 11:00 New York slot. The process cron should run every 15 minutes and the app processes only one due video per run, so the videos are generated one by one instead of all at once.
