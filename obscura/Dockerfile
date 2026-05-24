# Wrapper image around the upstream Obscura headless-browser binary
# (https://github.com/h4ckf0r0day/obscura). Upstream publishes only
# raw tarballs, so we package the Linux x86_64 binary into a small
# Debian-slim image and expose its Chrome DevTools Protocol port.

FROM debian:bookworm-slim AS fetcher

ARG OBSCURA_VERSION=v0.1.5
ARG OBSCURA_ASSET=obscura-x86_64-linux.tar.gz

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp
RUN curl -sSL -o obscura.tar.gz \
      "https://github.com/h4ckf0r0day/obscura/releases/download/${OBSCURA_VERSION}/${OBSCURA_ASSET}" \
 && tar -xzf obscura.tar.gz \
 && find . -maxdepth 2 -type f -name 'obscura*' -executable -exec cp {} /usr/local/bin/obscura \;  \
 && chmod +x /usr/local/bin/obscura

FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libssl3 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 obscura \
 && useradd  --system --uid 1001 --gid obscura --create-home --home-dir /home/obscura obscura

COPY --from=fetcher /usr/local/bin/obscura /usr/local/bin/obscura

USER obscura
WORKDIR /home/obscura

EXPOSE 9222

# Defaults — override in compose / K8s as needed.
ENV OBSCURA_HOST=0.0.0.0
ENV OBSCURA_PORT=9222

CMD ["obscura", "serve", "--host", "0.0.0.0", "--port", "9222"]
