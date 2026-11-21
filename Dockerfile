# Musico, hosted mode. Bun serves the dashboard; yt-dlp + ffmpeg do the ripping.
# Vercel and Cloudflare Workers cannot run this: no Python/ffmpeg, no writable disk.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PORT=8080 \
    NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl ffmpeg python3 python3-pip unzip zip \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp-ejs is the JS challenge solver YouTube now demands. Current yt-dlp pulls it
# in through [default], but naming it explicitly means a pip fallback to an older
# release cannot silently ship an image that fails every rip. It needs Python >= 3.10;
# bookworm's python3 is 3.11.
RUN pip3 install --no-cache-dir --break-system-packages "yt-dlp[default]" yt-dlp-ejs

# yt-dlp needs a JS runtime for those challenges; Deno is the one it looks for.
# The installer respects DENO_INSTALL and puts the binary in /usr/local/bin.
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app
COPY package.json ./
COPY src ./src

EXPOSE 8080
CMD ["bun", "src/hosted.ts"]
