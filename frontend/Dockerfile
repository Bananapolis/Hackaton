FROM node:20-bookworm-slim AS build
WORKDIR /app

ARG VITE_RTC_ICE_SERVERS=""
ENV VITE_RTC_ICE_SERVERS=${VITE_RTC_ICE_SERVERS}

ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

ARG VITE_APP_VERSION=""
ENV VITE_APP_VERSION=${VITE_APP_VERSION}

COPY package*.json ./
RUN npm ci

COPY . .
# Copy pre-built APK into dist if one exists (place at frontend/downloads/vialive-broadcaster.apk before building)
RUN npm run build && \
    if ls downloads/*.apk 2>/dev/null; then cp downloads/*.apk dist/; fi

FROM nginx:1.27.5

ARG BACKEND_HOST=backend
RUN --mount=type=bind,source=nginx.conf,target=/tmp/nginx.conf.template \
    envsubst '${BACKEND_HOST}' < /tmp/nginx.conf.template > /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
