#!/bin/bash
# UNIMPLEMENTED PLACEHOLDER — this does NOT sandbox anything.
# `security.sandbox.provider: local` runs the tool through this script
# unmodified (exec "$@"), with full host filesystem/network access. It is
# not a security boundary. For real isolation use `provider: docker`.
#
# To implement real local isolation, replace the exec below with an actual
# restriction mechanism for your OS, e.g.:
#   macOS:  exec sandbox-exec -f <profile.sb> "$@"
#   Linux:  exec bwrap --unshare-all --ro-bind / / --bind "$PROJECT_PATH" "$PROJECT_PATH" --die-with-parent "$@"
exec "$@"
