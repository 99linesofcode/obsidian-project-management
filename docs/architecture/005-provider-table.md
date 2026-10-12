# ADR 005 — Retire the descriptor/registrar; wire providers from a plain table

- **Status:** accepted
- **Date:** 2026-10-12
- **Amends:** ADR 001 (the registration decision, option 2A)

## Context

ADR 001 decided (option 2A) that each adapter module exports a typed
`AdapterDescriptor` (application id, capabilities, secret keys, settings rows)
and that the composition root passes a list of `AdapterRegistration`s to a
neutral, pure `registerAdapters`, which validates them and returns a
`RegistrationResult` of `RegisteredAdapter`s.

In practice the registrar validated a vocabulary nothing else consumed: the
capability list was descriptor metadata, not a port gate — the optional
surfaces are optional `MirrorPort` methods, presence-checked by the caller — and
both shipped descriptors always conformed, so the validation never rejected
anything at runtime. The descriptor, registration and registration result were
ceremony around a two-entry lookup: a provider framework for two adapters and
one vault.

## Decision

**The descriptor/registrar is deleted.** The composition root holds one plain
`providers` table — a value mapping an application id to its mirror factory,
capture factory, optional setup surface and token setting. It derives the
mirror-adapter factory, the setup factory, the registered-application set and
the token-settings list from that table. There is no validation framework, no
capability vocabulary and no registration result.

The capability vocabulary (`capabilities.ts`) is deleted with it; the canonical
fields (`canonicalField.ts`) remain, and an adapter's optional surfaces are the
optional methods on `MirrorPort`. The two factory seams
(`MirrorAdapterFactoryPort`, `ProjectSetupFactoryPort`) stay: they are real core
seams, injected into core actions and faked in tests, not registrar support.

A provider's name appears only in its own module and the composition root; the
token settings (secret key, label, description) are a plain list the settings
UI renders.

## Consequences

- `AdapterDescriptor`, `AdapterRegistration`, `RegisteredAdapter`,
  `registerAdapters`, `RegistrationError`, `RegistrationResult`, `SettingsRow`
  and `capabilities.ts` are gone, along with the three `*Descriptor.ts` files.
- Adding an application is one composition-root table entry; the kernel is not
  edited.
- Behaviour is unchanged for the shipped adapters: the registrar accepted both
  descriptors, and the conformance adapter is a test double, not a wired
  provider. Its application id is no longer added to the registered set.
- `ARCHITECTURE.md` and the developer manual drop the descriptor/registrar
  vocabulary.
