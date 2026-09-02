# 🤝 Contributing to Omnixys Authentication Service

Thank you for your interest in contributing to the **Omnixys Authentication Service**!  
This document defines our contribution workflow, coding standards, and pull request guidelines.

---

## 🧩 Development Environment

1. **Fork and clone** the repository  
   ```bash
   git clone https://github.com/your-username/omnixys-authentication-service.git
   cd omnixys-authentication-service
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Create a feature branch**
   ```bash
   git checkout -b feature/short-description
   ```

4. **Run and test**
   ```bash
   pnpm run lint && pnpm run test
   ```

---

## ✨ Contribution Types

- 🐛 Bug fixes
- 💡 New features
- 🧪 Refactoring and improvements
- 🧾 Documentation updates
- 🔒 Security or performance enhancements

---

## 💅 Code Style

- **Language:** TypeScript (NestJS)
- **Formatter:** Prettier with `.prettierrc.yml`
- **Linter:** ESLint with strict rules
- **Imports:** Sorted alphabetically (using Prettier plugin)
- **Naming:** `camelCase` for variables/functions, `PascalCase` for classes
- **Comments:** Use English for all code comments and docstrings

Example:
```ts
/**
 * Handles JWT token validation and caching.
 */
async validateToken(token: string): Promise<boolean> {
  // Verify using Keycloak public key
  return await this.keycloakService.verifyToken(token);
}
```

---

## 🧠 Pull Request Guidelines

1. Ensure your branch is up-to-date with `main`:
   ```bash
   git pull origin main
   ```

2. Run code checks before committing:
   ```bash
   pnpm run lint && pnpm run test
   ```

3. Use **conventional commits**:
   - `feat:` → new feature
   - `fix:` → bug fix
   - `docs:` → documentation changes
   - `refactor:` → code improvement
   - `test:` → tests only

   Example:
   ```bash
   git commit -m "feat: add Redis session TTL refresh logic"
   ```

4. Submit a **Pull Request (PR)** with a clear title and description:
   - What problem does this solve?
   - How was it tested?
   - Are there related issues?

5. Wait for a **review approval** from the Omnixys Core Team before merging.

---

## 🧾 Code Review Principles

- Keep PRs small, atomic, and easy to review.
- Write meaningful commit messages.
- All tests must pass before merge.
- PRs without tests will not be merged (except documentation).

---

## 🧭 Communication

- Use **English** for all commits, issues, and PR discussions.
- Prefer GitHub Discussions for architectural or feature debates.
- Be respectful, constructive, and concise.

---

© 2025 Caleb Gyamfi – Omnixys Technologies  
Licensed under GPL‑3.0‑or‑later
