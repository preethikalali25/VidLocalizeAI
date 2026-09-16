FROM node:20-slim

# ffmpeg (which also provides ffprobe) and curl (to fetch the yt-dlp
# binary below) are the non-npm dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp's standalone Linux build bundles its own Python runtime, so no
# separate Python install is needed. It self-updates its own extraction
# logic on `yt-dlp -U`, but this image pins whatever "latest" resolves to
# at build time -- rebuild periodically if YouTube downloads start failing
# with extraction errors (yt-dlp's most common failure mode when sites
# change their internals).
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
