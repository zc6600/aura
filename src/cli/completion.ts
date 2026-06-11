import type { Command } from 'clipanion';

export function completionZsh(cli: Command['cli']): string {
  const definitions = cli.definitions();
  const topLevel = new Map<string, string>();
  const subcommands: Record<string, Map<string, string>> = {};

  for (const def of definitions) {
    const parts = def.path.split(' ').slice(1);
    if (parts.length === 0) continue;

    const cmd = parts[0];
    const desc = def.description ? def.description.replace(/[[\]"]/g, '') : '';

    if (parts.length === 1) {
      if (!topLevel.has(cmd) || (desc && !topLevel.get(cmd))) {
        topLevel.set(cmd, desc);
      }
    } else {
      const sub = parts[1];
      if (!subcommands[cmd]) {
        subcommands[cmd] = new Map<string, string>();
      }
      if (!subcommands[cmd].has(sub) || (desc && !subcommands[cmd].get(sub))) {
        subcommands[cmd].set(sub, desc);
      }
      if (!topLevel.has(cmd)) {
        topLevel.set(cmd, `${cmd} commands`);
      }
    }
  }

  const topLevelOptions = Array.from(topLevel.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cmd, desc]) => `        "${cmd}[${desc || `${cmd} command`}]"`)
    .join(' \\\n');

  const cases: string[] = [];
  for (const [cmd, subs] of Object.entries(subcommands)) {
    const subOptions = Array.from(subs.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([sub, desc]) => `            "${sub}[${desc || `${sub} subcommand`}]"`,
      )
      .join(' \\\n');

    const cmdAliases = [cmd];
    if (cmd === 'tools') cmdAliases.push('t');
    if (cmd === 'hints') cmdAliases.push('h');
    if (cmd === 'skill') cmdAliases.push('s');
    if (cmd === 'kernel') cmdAliases.push('k');
    if (cmd === 'agent') cmdAliases.push('c');
    if (cmd === 'version') cmdAliases.push('v');

    cases.push(`        ${cmdAliases.join('|')})
          _values "${cmd} subcommand" \\
${subOptions}
          ;;`);
  }

  return [
    '#compdef aura',
    '',
    '_aura() {',
    '  local state',
    '  _arguments -C \\',
    '    "1: :->cmds" \\',
    '    "*: :->args"',
    '',
    '  case "$state" in',
    '    cmds)',
    '      _values "aura command" \\',
    topLevelOptions,
    '      ;;',
    '    args)',
    '      case "$words[1]" in',
    cases.join('\n'),
    '      esac',
    '      ;;',
    '  esac',
    '}',
    '',
    'compdef _aura aura',
  ].join('\n');
}

export function completionBash(cli: Command['cli']): string {
  const definitions = cli.definitions();
  const topLevel = new Set<string>();
  const subcommands: Record<string, Set<string>> = {};

  for (const def of definitions) {
    const parts = def.path.split(' ').slice(1);
    if (parts.length === 0) continue;

    const cmd = parts[0];
    topLevel.add(cmd);

    if (parts.length > 1) {
      const sub = parts[1];
      if (!subcommands[cmd]) {
        subcommands[cmd] = new Set<string>();
      }
      subcommands[cmd].add(sub);
    }
  }

  const topLevelStr = Array.from(topLevel).sort().join(' ');
  const cases: string[] = [];

  for (const [cmd, subs] of Object.entries(subcommands)) {
    const subsStr = Array.from(subs).sort().join(' ');
    cases.push(`    ${cmd})
      COMPREPLY=( $(compgen -W "${subsStr}" -- \${cur}) )
      return 0
      ;;`);
  }

  return [
    `_aura() {`,
    `  local cur prev`,
    `  COMPREPLY=()`,
    `  cur="\${COMP_WORDS[COMP_CWORD]}"`,
    `  prev="\${COMP_WORDS[COMP_CWORD-1]}"`,
    ``,
    `  local commands="${topLevelStr}"`,
    ``,
    `  if [ $COMP_CWORD -eq 1 ]; then`,
    `    COMPREPLY=( $(compgen -W "\${commands}" -- \${cur}) )`,
    `    return 0`,
    `  fi`,
    ``,
    `  case "\${COMP_WORDS[1]}" in`,
    cases.join('\n'),
    `  esac`,
    `}`,
    `complete -F _aura aura`,
  ].join('\n');
}
