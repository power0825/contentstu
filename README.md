# Image Agent Studio — Standalone Edition

English web app with email/password registration and login. It runs independently of ChatGPT, Sites and Cloudflare. One command starts the Vite frontend and Node API together.

## Requirements

- Node.js 22.13 or newer (Node.js 24 recommended)
- npm

## Start developing

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. Create an account using your email and a password of at least 8 characters, then sign in. Registration also signs you in automatically.

You can register, save your agent configuration and upload reference images before configuring the AI models.

## Connect the models

Copy `.env.example` to `.env` in the project root and edit it:

```dotenv
HOST=127.0.0.1
PORT=5173
PUBLIC_ORIGIN=
VOLCENGINE_API_KEY=your_api_key
VOLCENGINE_TEXT_MODEL=doubao-seed-2-1-turbo-260628
VOLCENGINE_IMAGE_MODEL=doubao-seedream-4-5-251128
DAILY_IMAGE_LIMIT=20
COOKIE_SECURE=false
```

Use the exact language-model ID from your Volcengine console. The API key stays on the server and is never sent to learners' browsers. Restart the server after changing `.env`.

Both models use the Volcengine Ark API at `https://ark.cn-beijing.volces.com/api/v3`.

## Pages

- **Sign in / Create account:** independent email/password authentication.
- **Create:** upload a reference, enter a brief, prepare and edit the prompt, generate, compare, download and refine images.
- **My agent:** edit business rules, paste or upload a Markdown Skill, import/export agent configuration.
- **History:** reopen saved generations and make revisions.
- **Video Studio:** plan shots, generate frames and clips, trim and assemble a final MP4.

Skill files are read as text instructions. Scripts, tools and package attachments are not executed.

## Saved data

`data/studio.sqlite` stores users, hashed passwords, hashed sessions, profiles, image metadata and generation history. `data/images/` stores uploaded and generated images. These folders are created automatically. Keep and back up the entire `data/` folder to preserve accounts and images.

Passwords use scrypt with a unique salt. Login uses HttpOnly session cookies, and every image/configuration query checks the signed-in account. Registration does not verify email ownership. Password-reset emails are not implemented.

## Build and run

```sh
npm run build
npm start
```

The production server serves the compiled frontend and API from the same port. For a classroom server, set `HOST=0.0.0.0`. For deployment behind an HTTPS reverse proxy, set `PUBLIC_ORIGIN` to the exact public origin (for example `https://images.example.com`) and `COOKIE_SECURE=true`. Forward requests to the Node server, including API routes. Public use requires HTTPS; do not put `.env` or `data/` in a public static directory.

This edition uses local SQLite and files, so deploy a single Node instance with persistent disk storage. It is not a static-only hosting package. `npm run dev` includes the local API; no separate backend command is needed.

## Verification

```sh
npm test
```

Tests cover registration, login, logout, password hashing, session ownership, private image access, account-isolated settings, restart persistence and failure handling. Model request flow is tested with simulated provider responses. Live generation still requires your API key and configured model ID.

Daily app allowances reset at midnight UTC. Failed image/prompt requests restore the app allowance, although a provider may still charge for an upstream request that completed before a network timeout.

## Video Studio

The standalone edition includes a five-step Video Studio: brief → storyboard → images → clips → edit/export. Uses Volcengine for storyboard/prompt preparation and image generation; Alibaba Cloud Bailian `wan3.0-video` for asynchronous first-frame / first-last-frame generation. Configure `BAILIAN_API_KEY` and `BAILIAN_BASE_URL` in `.env` (see `.env.example`).

Requires local FFmpeg and FFprobe for MP4 export, with libx264, AAC and libass/subtitles support. `FFMPEG_PATH` and `FFPROBE_PATH` may be absolute executable paths. The server uses shell-free process arguments. Export normalizes clips to 720P at 30fps, supports trim start, final-frame holds, cuts/fades, optional shot captions, final brand text/logo, and either uploaded music or built-in ambient tones.

Projects, provider task IDs and private media survive server restart. Background polling runs every 15 seconds while the server is running; completed provider videos are downloaded promptly. Video submission limits count attempts (including failure/uncertain submission); verify uncertain submissions in the provider console before retrying. For online classroom use, run on a persistent server behind HTTPS, configure `PUBLIC_ORIGIN` and secure cookies.

Tests include simulated provider calls and a real 15-second FFmpeg assembly. Real model generation must be verified with configured API keys. See `START_HERE_zh.md` for detailed configuration and teaching flow.
