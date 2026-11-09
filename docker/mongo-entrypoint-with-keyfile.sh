#!/bin/sh
set -eu

umask 077
openssl rand -base64 756 | tr -d '\n' > /tmp/mongo-keyfile
chown mongodb:mongodb /tmp/mongo-keyfile
chmod 400 /tmp/mongo-keyfile

exec /usr/local/bin/docker-entrypoint.sh "$@"
