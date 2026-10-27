FROM node:24-bookworm-slim
WORKDIR /workspace
COPY runtime.tar /runtime.tar
RUN tar -xf /runtime.tar -C /workspace && rm /runtime.tar
ARG CANDIDATE_SHA
LABEL org.radar.a2base.candidate=$CANDIDATE_SHA
CMD ["bash", "tools/make/base-api-a2rest-image-container.sh"]
