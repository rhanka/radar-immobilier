# LEGACY wrapper image — kept for local debugging builds only; NOT built by CI
# and NOT used by production nor by the compose dev stack any more.
#
# Production (deploy/k8s/35-obscura.yaml) and docker-compose.yml both run the
# upstream PUBLIC Docker Hub image docker.io/h4ckf0r0day/obscura:0.1.5 (pinned
# by digest): same v0.1.5 release as the tarball below, distroless/cc,
# ENTRYPOINT /obscura, no shell. This Dockerfile re-packages that release into
# a Debian-slim image with a shell and a non-root user (uid 1001) — handy when
# you need to `docker exec … sh` into the container; candidate for removal in a
# follow-up PR. Build by hand: `docker build -t radar-obscura obscura/`.
#
# Wrapper image around the upstream Obscura headless-browser binary
# (https://github.com/h4ckf0r0day/obscura): packages the Linux x86_64 release
# binary into a small Debian-slim image and exposes its CDP port.

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
