# Security

Security reports can be filed privately through GitHub's security advisory feature for `yhay81/shoshi-hiki`.

- Search and telemetry accept same-origin JSON POST requests only.
- Request bodies are size limited and normalized; ISBN checksums are validated.
- Official XML is size limited, validated, and rejected when it declares DTDs or entities.
- Official data is rendered with DOM `textContent`; source HTML is never interpreted.
- Returned links are allowlisted to NDL Search book records.
- Search conditions and official responses are not persisted server-side.
- Content Security Policy blocks third-party scripts and framing.
