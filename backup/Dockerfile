FROM alpine:3.22
RUN apk add --no-cache restic curl jq git rsync tzdata coreutils
COPY entrypoint.sh backup.sh restore.sh lib.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/*.sh \
 && ln -s /usr/local/bin/backup.sh /usr/local/bin/backup \
 && ln -s /usr/local/bin/restore.sh /usr/local/bin/restore \
 && mkdir -p /cache /status && chown 1000:1000 /cache /status
ENV RESTIC_REPOSITORY=/repo \
    RESTIC_CACHE_DIR=/cache/restic \
    STATUS_FILE=/status/backup.json \
    HOME=/cache
USER 1000:1000
HEALTHCHECK --interval=5m --timeout=10s --start-period=2m --retries=1 \
  CMD /usr/local/bin/entrypoint.sh healthcheck
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["schedule"]
