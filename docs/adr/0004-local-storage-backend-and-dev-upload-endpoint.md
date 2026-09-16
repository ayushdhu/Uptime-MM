# ADR-0004: Local disk storage backend with a dev upload endpoint

Status: accepted. Date: 2026-09-16.

## Context

The spec fixes S3 compatible object storage and a presign / PUT / confirm
upload flow with server side SHA-256 verification. Developers and the test
suite need the same flow without credentials or a network.

## Decision

`Storage` is a facade with two backends. `S3Backend` (aws-sdk-s3) is selected
when `S3_BUCKET` is set. Otherwise `LocalBackend` stores objects under
`tmp/storage/<env>` and "presigns" URLs pointing at `PUT/GET /dev/storage/*key`,
which is mounted only while the local backend is active (404 otherwise). Hash
verification, byte size checks and report storage run through the same facade
so the code path is identical in both cases.

## Consequences

The pilot's yard server can run with real S3 (or MinIO via `S3_ENDPOINT`) by
setting environment variables only. Nothing in the app changes: it uploads to
whatever URL presign returns.
