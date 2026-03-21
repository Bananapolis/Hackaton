FROM node:20-bookworm-slim AS build
WORKDIR /app

ARG VITE_RTC_ICE_SERVERS=""
ENV VITE_RTC_ICE_SERVERS=${VITE_RTC_ICE_SERVERS}

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27.5
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
