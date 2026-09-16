# ADR-0003: customer_assignments for technician scoping

Status: accepted. Date: 2026-09-16.

## Context

Spec 8 says the API must never return a machine to a technician who is not
assigned to its customer, but the data model in spec 4 has no table that
records which technicians are assigned to which customers.

## Decision

Add `customer_assignments (user_id, customer_id)` with a unique pair index.
Pundit scopes for machines, inspections, customers and High severity events
resolve through it; admins see everything; the future owner role resolves
through `users.customer_id` as the spec already anticipates.

## Consequences

Assigning a technician to a customer is an admin action (no UI in the MVP;
done in the console or seeds). Lookups by NFC, serial and name are all run
inside the scope, so an unassigned technician gets "unregistered tag" / not
found rather than a leak of another customer's machine.
