#!/bin/sh
set -e
# First start: seed the persistent volume with the demo project.
if [ ! -f "$NEXUS_PROJECT_DIR/project.yaml" ]; then
  echo "Initialising project in $NEXUS_PROJECT_DIR"
  mkdir -p "$NEXUS_PROJECT_DIR"
  cp -r /app/project-template/. "$NEXUS_PROJECT_DIR/"
fi
mkdir -p "$NEXUS_DATA_DIR"
exec "$@"
