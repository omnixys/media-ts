/**
 * @license GPL-3.0-or-later
 * Copyright (C) 2025 Caleb Gyamfi
 * Omnixys Technologies
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * For more information, visit <https://www.gnu.org/licenses/>.
 */
/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: in use */

/**
 * Semantic Release configuration for Omnixys microservices.
 *
 * Features:
 * - Automatic semantic versioning (patch/minor/major)
 * - Conventional Commits based analysis
 * - Automatic CHANGELOG.md generation
 * - Git tag creation (vX.Y.Z)
 * - GitHub Release creation
 * - CI-safe (skip-ci on release commit)
 * - pnpm compatible
 */

export default {
  /**
   * Release is only allowed from main
   */
  branches: ['main'],

  /**
   * Explicit tag format
   */
  tagFormat: 'v${version}',

  /**
   * Plugins pipeline
   */
  plugins: [
    /**
     * Analyze commits and determine next version
     */
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [
          { type: 'breaking', release: 'major' },
          { type: 'feat', release: 'minor' },
          { type: 'fix', release: 'patch' },
          { type: 'perf', release: 'patch' },
          { type: 'refactor', release: 'patch' },
          { type: 'revert', release: 'patch' },
          { type: 'update', release: 'patch' },

          // Explicitly ignore these types
          { type: 'docs', release: false },
          { type: 'style', release: false },
          { type: 'test', release: false },
          { type: 'chore', release: false },
          { type: 'ci', release: false },
          { type: 'build', release: false },
        ],
      },
    ],

    /**
     * Generate structured release notes
     */
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',

        writerOpts: {
          groupBy: 'scope',
          commitGroupsSort: 'title',
          commitsSort: ['type', 'scope', 'subject'],

          transform(commit) {
            const issues =
              commit.references?.map((ref) => `#${ref.issue}`) ?? [];

            return {
              ...commit,
              scope: commit.scope
                ? commit.scope.charAt(0).toUpperCase() + commit.scope.slice(1)
                : 'Other',
              subject: commit.subject,
              issues,
            };
          },
        },

        presetConfig: {
          types: [
            { type: 'feat', section: '✨ Features' },
            { type: 'fix', section: '🐛 Bug Fixes' },
            { type: 'perf', section: '⚡ Performance Improvements' },
            { type: 'refactor', section: '♻️ Refactoring' },
            { type: 'revert', section: '⏪ Reverts' },
          ],
        },
      },
    ],

    /**
     * Generate / update CHANGELOG.md
     */
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
        changelogTitle:
          '# 🧾 Changelog\n\nAll notable changes in this project will be documented in this file.\n',
      },
    ],

    /**
     * 🔥 THIS is what you were missing
     * Updates package.json version
     */
    [
      '@semantic-release/npm',
      {
        npmPublish: false,
      },
    ],

    /**
     * Commit release artifacts back to repository
     */
    [
      '@semantic-release/git',
      {
        assets: ['package.json', 'pnpm-lock.yaml', 'CHANGELOG.md'],
        message:
          'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],

    /**
     * Create GitHub Release
     */
    [
      '@semantic-release/github',
      {
        assets: [
          { path: 'CHANGELOG.md', label: 'Changelog' },
          { path: 'dist/**', label: 'Build Artifacts' },
        ],

        releaseBodyTemplate: `
        # 🚀 Release v<%= nextRelease.version %>
---

## 📦 Changes

<%= nextRelease.notes %>

---

## 🔎 Release Details

- Git Tag: <%= nextRelease.gitTag %>
- Branch: <%= branch.name %>
- Previous Version: <%= lastRelease ? lastRelease.version : 'N/A' %>
- Commit: <%= nextRelease.gitHead.substring(0, 7) %>

---

🏢 **Organization:** Omnixys
📦 **Package:** Media TS
🔗 **Repository:** Repository: <%= options.repositoryUrl %>
🧭 **Docs:** https://omnixys.com/docs
`,
      },
    ],
  ],
};
