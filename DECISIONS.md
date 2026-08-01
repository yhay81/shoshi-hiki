# Decisions

## Product boundary

- Search completed Japanese National Bibliography book records by title, creator, or ISBN.
- Show source metadata needed to distinguish editions and prepare a citation.
- Link every result to its official NDL Search record.
- Keep saved cards on the current browser only.
- Do not import cover images, availability claims, reviews, prices, or third-party library links.

## Service boundary

- Proxy bounded OpenSearch requests through one serialized Durable Object.
- Keep only a completion timestamp in Durable Object storage.
- Keep searches, responses, and bibliographic IDs out of D1 and request URLs.
- Add authentication only if real usage demonstrates a need for private cross-device state.
