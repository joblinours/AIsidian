FROM alpine:3.22
RUN apk add --no-cache curl jq
COPY init.sh /usr/local/bin/couchdb-init
RUN chmod 0755 /usr/local/bin/couchdb-init
USER nobody
ENTRYPOINT ["/usr/local/bin/couchdb-init"]
