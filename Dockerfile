# Musico, hosted mode. Bun serves the dashboard; yt-dlp + ffmpeg do the ripping.
# Vercel and Cloudflare Workers cannot run this: no Python/ffmpeg, no writable disk.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PORT=8080 \
    NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl ffmpeg python3 python3-pip zip \
 && rm -rf /var/lib/apt/lists/*

# [default] pulls in yt-dlp-ejs, the JS challenge solver YouTube now demands.
RUN pip3 install --no-cache-dir --break-system-packages "yt-dlp[default]"

# yt-dlp needs a JS runtime for those challenges; Deno is the one it looks for.
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app
COPY package.json ./
COPY src ./src

EXPOSE 8080
CMD ["bun", "src/hosted.ts"]
