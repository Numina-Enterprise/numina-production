# Existing D1 schema

Release 0.1.0 established numina_events_v1, numina_violations_v1, and numina_limits_v1 with the SQL preserved in src/store.js (SCHEMA). These tables were confirmed through Sites database inspection. Release 0.2.0 changes no columns or indexes and removes runtime DDL. The local SQLite adapter initializes an equivalent isolated test database.

Future changes require a Drizzle schema baseline and generated, inspected migrations packaged in dist/.openai/drizzle. Do not edit live database schema during request handling. Do not clear event/nonce state during upgrades or rollback. No migration history is fabricated for the earlier runtime-created schema.
