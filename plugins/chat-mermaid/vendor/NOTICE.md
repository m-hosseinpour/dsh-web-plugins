# Vendored library

`vendor/mermaid.min.js` is the Mermaid diagram renderer, shipped unmodified so the
plugin works without a network request to a third-party CDN.

- Upstream: https://github.com/mermaid-js/mermaid
- Version: 11.17.2
- Artifact: `dist/mermaid.min.js` (UMD build), fetched from
  https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js
- SHA-256: `581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8`
- License: MIT — see `LICENSE` beside this file.

The library is served to the page by this package's Host half at
`/dsh-mermaid/mermaid.min.js`; it is not imported at build time.
