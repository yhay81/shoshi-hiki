# Metrics

Allowed events are `visited`, `searched`, `no_result`, `official_opened`, `citation_copied`, `saved`, and `returned`.

Each row contains only a SHA-256 hash of a random browser UUID, an allowlisted event name, a QA flag, and a timestamp. Rows expire after 35 days. Search text, mode, bibliographic ID, ISBN, official response data, saved-card content, IP addresses, and advertising identifiers are not schema fields.

Run `npm run metrics` for production or `pwsh -File ops/product-metrics.ps1 -Local` for local state. Evaluate real-user rows only; `is_qa = 1` never counts as a user.
