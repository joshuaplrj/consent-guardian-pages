# Consent Guardian dashboard

This repository contains only the static, non-secret parent dashboard for Consent Guardian. The Android app and signaling Worker source remain in the private repository.

The dashboard requires a Worker-issued parent token and a one-time pairing code before it can receive a WebRTC session. Do not put Worker secrets or TURN credentials in this repository.
