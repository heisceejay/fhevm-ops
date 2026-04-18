# fhevm-ops

An AI agent skill and reference library for developing confidential smart contracts using the Zama FHEVM (Fully Homomorphic Encryption Virtual Machine).

## Overview

This repository is designed to be ingested by AI coding assistants (like Copilot, Claude, Gemini, etc.) to give them deep, accurate, and up-to-date knowledge about writing smart contracts with Zama's FHEVM. Because FHEVM introduces novel concepts like symbolic execution, encrypted variable types handles, and specific no-revert patterns, standard Solidity knowledge is not enough.

It can also act as a comprehensive starter kit and reference guide for human developers building on FHEVM.

## Repository Structure

The repository is organized into three main components:

- **`SKILL.md`**: The master ruleset. This is the entry point that provides the mental model, the non-negotiable rules of FHEVM, and core patterns.
- **`references/`**: In-depth markdown files covering specific, advanced topics:
  - `acl-and-decryption.md`: Access control, EIP-712 user decryption, and public decryption.
  - `operations.md`: FHE math operators, comparisons, casting, and gas (HCU) considerations.
  - `erc7984.md`: Confidential ERC-20 standard (ERC-7984) and extensions.
  - `testing-and-deployment.md`: Hardhat setup, writing tests with mock FHE, and deployment details.
  - `frontend.md`: Building dApps using `fhevmjs` and `@zama-fhe/relayer-sdk`.
  - `anti-patterns.md`: A catalog of common silent failures and security footguns to avoid.
  - `migration.md`: Step-by-step guide on migrating existing plaintext Solidity to FHEVM.
- **`assets/`**: Ready-to-use, copy-pasteable files.
  - `contracts/`: Production-grade examples (`ERC7984Token`, `BlindAuction`, `ConfidentialVoting`, `WrappedToken`).
  - `config/`: Pre-configured `hardhat.config.ts`, `package.json`, and `tsconfig.json` with correctly pinned dependencies.
  - `scripts/`: Deployment and interaction scripts.
  - `test/`: Hardhat test suites showcasing how to test encrypted state.

## How to Use

### For AI Agents
Point your AI assistant to this repository or directly provide it the contents of `SKILL.md`. The prompt inside `SKILL.md` will guide the model to load specific reference files from the `references/` directory as needed based on the user's task.

### For Developers
1. Read `SKILL.md` to understand the mental model and the "Five Rules" of FHEVM development.
2. Browse the `assets/` directory to grab configurations and boilerplate contracts to bootstrap your project.
3. Consult the `references/` directory when you need to understand specific edge cases, access control, or how to write frontend code.

## Quick Start Template

If you are starting a new project, use the assets in this repository to bootstrap quickly:
1. Copy `assets/config/package.json` and install dependencies.
2. Copy `assets/config/hardhat.config.ts`.
3. Grab a base contract from `assets/contracts/` to start modifying.

## License

MIT License. See `LICENSE.txt` for full terms. Includes conditions related to the underlying Zama FHEVM library.
