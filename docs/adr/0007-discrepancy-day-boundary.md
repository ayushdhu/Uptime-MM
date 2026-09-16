# ADR-0007: Discrepancy alerts use the UTC calendar day

Status: accepted. Date: 2026-09-16.

Spec 10 keys discrepancy detection on "the same calendar day". The server
stores `performed_at` in UTC and the pilot runs in one yard, so the MVP
compares the UTC date of `performed_at`. When customers span time zones, add
`customers.time_zone` and compare in the customer's zone; the alert table does
not change.
