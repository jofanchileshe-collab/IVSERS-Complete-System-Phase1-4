# ==============================================================================
# IVSERS Frontend - Dockerfile
#
# Static site, no build step (plain HTML/CSS/JS - see nginx.conf for the
# API/Socket.IO reverse proxy that wires this container to the backend).
# ==============================================================================

FROM nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html

# Don't ship this Dockerfile/nginx.conf themselves into the served root.
RUN rm -f /usr/share/nginx/html/Dockerfile /usr/share/nginx/html/nginx.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
