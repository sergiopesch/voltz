const BASH_COMPLETIONS = `
_voltz() {
  local cur prev commands flags
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="chat look setup doctor completions"
  flags="--verbose --quiet --version --help"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands} \${flags}" -- "\${cur}") )
    return 0
  fi

  case "\${prev}" in
    completions)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      ;;
    *)
      COMPREPLY=( $(compgen -W "\${flags}" -- "\${cur}") )
      ;;
  esac
}
complete -F _voltz voltz
`.trim();

const ZSH_COMPLETIONS = `
#compdef voltz

_voltz() {
  local -a commands flags
  commands=(
    'chat:Text-only chat mode'
    'look:Capture webcam frame and analyze with vision'
    'setup:Configure API key, test microphone and speaker'
    'doctor:Run diagnostic checks'
    'completions:Output shell completion script'
  )
  flags=(
    '--verbose[Enable debug logging]'
    '--quiet[Suppress non-error output]'
    '--version[Show version]'
    '--help[Show help]'
  )

  _arguments -C \\
    '1:command:->cmds' \\
    '*::arg:->args'

  case "\$state" in
    cmds)
      _describe -t commands 'voltz commands' commands
      _describe -t flags 'flags' flags
      ;;
    args)
      case \$words[1] in
        completions)
          _values 'shell' bash zsh fish
          ;;
      esac
      ;;
  esac
}

_voltz
`.trim();

const FISH_COMPLETIONS = `
complete -c voltz -n '__fish_use_subcommand' -a chat -d 'Text-only chat mode'
complete -c voltz -n '__fish_use_subcommand' -a look -d 'Capture webcam frame and analyze with vision'
complete -c voltz -n '__fish_use_subcommand' -a setup -d 'Configure API key, test microphone and speaker'
complete -c voltz -n '__fish_use_subcommand' -a doctor -d 'Run diagnostic checks'
complete -c voltz -n '__fish_use_subcommand' -a completions -d 'Output shell completion script'
complete -c voltz -l verbose -d 'Enable debug logging'
complete -c voltz -l quiet -d 'Suppress non-error output'
complete -c voltz -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish'
`.trim();

export function completionsCommand(shell?: string): void {
  const target = shell ?? detectShell();

  switch (target) {
    case "bash":
      console.log(BASH_COMPLETIONS);
      break;
    case "zsh":
      console.log(ZSH_COMPLETIONS);
      break;
    case "fish":
      console.log(FISH_COMPLETIONS);
      break;
    default:
      console.error(
        `Unknown shell: ${target}. Supported: bash, zsh, fish`
      );
      process.exit(1);
  }
}

function detectShell(): string {
  const shell = process.env.SHELL ?? "";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("fish")) return "fish";
  return "bash";
}
