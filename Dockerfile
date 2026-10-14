# Image Agent Studio - production image
#
# Builds the Vite front-end, then serves the static bundle and the /api/*
# routes from the zero-dependency Node server in server/start.mjs.
#
# FFmpeg is installed here on purpose: server/video.mjs spawns ffmpeg/ffprobe
# to trim, concat, burn ASS captions and mix background music. A managed
# buildpack (Railway Nixpacks) will NOT give you those binaries.

FROM node:22-bookworm-slim

# ffmpeg  -> required by the video export pipeline (spawn in server/video.mjs)
# fonts   -> the libass `subtitles` filter needs real font files at runtime
#   fonts-noto-cjk matters when the interface is set to Chinese: without a font that actually
#   contains Chinese glyphs, burned-in captions render as empty boxes. It is a large package
#   (~190 MB installed). Swap it for fonts-wqy-zenhei (~16 MB) if image size ever becomes a
#   problem, and point CAPTION_FONT_CJK at "WenQuanYi Zen Hei" when you do.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      fonts-dejavu-core \
      fonts-liberation \
      fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ALL dependencies first. typescript and vite are devDependencies and
# are required by `npm run build`, so NODE_ENV must not be "production" yet.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# start.mjs reads HOST, PORT and DATA_DIR. PORT is injected by the platform.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

# /app/data holds studio.sqlite plus uploaded and generated media.
# Mount a Railway Volume there so it survives redeploys.

CMD ["node", "server/start.mjs", "--production"]
