# Open-Source Layout

This folder contains two **standalone sub-repos** intended to be published as separate open-source repositories:

| Repo | Contents | Purpose |
|------|----------|---------|
| **goo-core** | Off-chain Core (TypeScript): survival engine + autonomy loop | Run alongside a Goo Agent; can be published as its own git + npm package. |
| **goo-contracts** | On-chain contracts (Solidity): interfaces + reference implementations + mocks | Publish as npm package for Solidity `import`; no Forge/tests required for the package. |

Each sub-repo has its own **README**, **.gitignore**, and **docs/** (THESIS, protocol spec, Goo Agent specs, API, Pulse format).

To publish:

1. Copy each subfolder to a new git repository (e.g. `github.com/hertzbot-v/goo-core`, `github.com/hertzbot-v/goo-contracts`).
2. Run `git init` and add remotes.
3. For **goo-contracts**: optionally publish to npm as `goo-contracts` so others can `npm install goo-contracts` and import in Solidity.
4. For **goo-core**: optionally publish to npm as `goo-core`; keep `package.json` name consistent.

Parent monorepo: [TUI-MODE-A / Goo](https://github.com/hertzbot-v/Goo) (or your main repo).
