# ADR-0011: High severity acknowledgment by initials; statement optional

Status: accepted. Date: 2026-09-16. Reverses the "owner's own words" rule in
spec 6 step 3 and the `signer_statement` guidance in 4.2.

## Context

The High severity flow required the owner to type a statement in their own
words before signing. In a yard at the end of a visit that yields "ok" or an
empty field, which is worse evidence than a clean acknowledgment because it
looks as if something was gathered when nothing was.

## Decision

- A required **owner initials** field (typed by the owner, 1 to 6
  characters), stored in `high_severity_events.conversation_checklist` as
  `owner_initials`. The server rejects an event without it.
- Text above it, to the effect: by initialling and signing, the owner
  confirms they understand what was found and what Uptime recommended, and
  that deciding what to do about it is theirs to make. This acknowledges
  understanding; it does not disclaim liability. Liability language belongs
  in the signed service agreement, reviewed per state, never in the app.
- The existing signature is unchanged and still required.
- The free text statement stays but is optional. `signatures.signer_statement`
  is unchanged in the schema and is now nullable in practice. The visit where
  an owner insists on running a machine against the recommendation is exactly
  when their own words matter, and the field is there for it.
- Initials are typed only. "Drawn" initials would need a second image per
  event and the data model is frozen; the signature strokes already provide
  a drawn mark. Revisit if the pilot shows typed initials are disputed.

## Consequences

The report's acknowledgment block shows the initials next to the signer.
Older clients that omit initials get a 422 with a specific reason.
