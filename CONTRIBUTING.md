# Contributing to Goo Core

Thanks for your interest in contributing to `goo-core`!

## How to contribute

1. Fork the repo.
2. Create a feature branch (e.g. `feat/my-change`).
3. Add/adjust tests for your change.
4. Open a Pull Request.

## Development

Install dependencies:
```bash
npm ci
```

Run tests:
```bash
npm run test:unit
npm run test:integration
```

## Code style

This project uses TypeScript + ESM and is expected to be compatible with `vitest`.
If you change behavior, update docs where appropriate.

## Reporting issues

Use GitHub Issues for bugs and feature requests. Include:

- what you expected vs what happened
- steps to reproduce (if applicable)
- any relevant logs or stack traces

