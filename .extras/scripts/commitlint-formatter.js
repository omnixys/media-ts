import chalk from 'chalk';

export default function omnixysFormatter(resultsArg) {
  // Normalize for Commitlint v20+ (has .results property)
  const results = Array.isArray(resultsArg)
    ? resultsArg
    : resultsArg?.results
      ? resultsArg.results
      : [resultsArg];

  let output = '\n';

  for (const result of results) {
    if (!result || (!result.errors?.length && !result.warnings?.length))
      continue;

    const { input = '(no input)', errors = [], warnings = [] } = result;

    output += chalk.bgRed.white.bold('\n 🚫 Invalid Commit Message Detected\n');
    output += chalk.gray('──────────────────────────────────────────────\n');
    output += chalk.cyan(`🧩 Input: ${input}\n\n`);

    for (const err of errors) {
      switch (err.name) {
        case 'type-empty':
          output +=
            chalk.red('❌ Missing commit type ') +
            chalk.gray('(e.g. feat, fix, chore, docs, refactor)\n');
          break;
        case 'subject-empty':
          output += chalk.red(
            '❌ Missing short description after type/scope\n',
          );
          break;
        default:
          output += chalk.yellow(`⚠️  ${err.message}\n`);
      }
    }

    for (const warn of warnings) {
      output += chalk.yellow(`⚠️  ${warn.message}\n`);
    }

    output +=
      '\n' + chalk.gray('──────────────────────────────────────────────\n');
    output += chalk.green.bold('✅ Example (valid message):\n');
    output += chalk.white('   feat(auth): add JWT login validation\n');
    output += chalk.white('   fix(docker): correct image build action path\n');
    output += chalk.white('   docs(readme): update contributing section\n\n');
    output += chalk.magentaBright(
      '💡 Tip: Follow Omnixys Conventional Commit rules for consistent history.\n',
    );
    output += chalk.gray('──────────────────────────────────────────────\n\n');
  }

  // Always show output, even if no TTY
  // console.error(output);
  return output;
}
