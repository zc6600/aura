# frozen_string_literal: true

require "thor"

module Aura
  module Commands
    class CompletionCommand < Thor
      default_task :completion

      def self.exit_on_failure?
        true
      end

      desc "completion [SHELL]", "Generate shell autocompletion script (bash or zsh)"
      def completion(shell = nil)
        shell ||= ENV["SHELL"]&.include?("zsh") ? "zsh" : "bash"
        case shell.to_s.downcase
        when "zsh"
          puts zsh_completion
        else
          puts bash_completion
        end
      end

      private

      def zsh_completion
        <<~'ZSH'
          #compdef aura

          _aura() {
            local line state

            _arguments -C \
              "1: :->cmds" \
              "*: :->args"

            case "$state" in
              cmds)
                _values "aura command" \
                  "add[Stage files inside the local Aura environment]" \
                  "ask[Directly ask the LLM a question without launching interactive chat]" \
                  "branch[List, switch, or create customized agent profiles]" \
                  "chat[Start an interactive Aura chat session]" \
                  "commit[Commit staged changes inside the local Aura environment]" \
                  "config[Read or write configuration settings]" \
                  "context[Compile and print project context]" \
                  "delete[Unregister an Aura project and cleanly wipe local workspace]" \
                  "doctor[Run environment checks]" \
                  "info[Display comprehensive system information]" \
                  "hints[Manage context/magic hint injection configurations]" \
                  "kernel[Kernel commands]" \
                  "list[List all globally registered Aura projects]" \
                  "new[Initialize an in-place Aura environment linked to a project name]" \
                  "prune[Remove all registered projects whose paths do not exist]" \
                  "pull[Pull new templates or updates from the global repository]" \
                  "register[Register the current directory as an active Aura workspace]" \
                  "skill[Manage agent skills in the active workspace]" \
                  "status[Show what files are modified or untracked]" \
                  "sync[Push local workspace changes back to the global repository]" \
                  "template[Template management and sync]" \
                  "tools[Tools management commands]" \
                  "tree[Print a tree of all available commands]" \
                  "update[Update framework, templates, and sub-projects]" \
                  "version[Show Aura version]" \
                  "web[Start a lightweight Aura web server]" \
                  "completion[Generate shell autocompletion script (bash or zsh)]"
                ;;
              args)
                case "$words[1]" in
                  hints|h)
                    _values "hints subcommand" \
                      "list[List all files parsed for hint injection and their status]" \
                      "toggle[Toggle hint injection status for a file]"
                    ;;
                  kernel|k)
                    _values "kernel subcommand" \
                      "start[Start the background kernel]" \
                      "stop[Stop the background kernel]" \
                      "status[Show status of background kernel]" \
                      "logs[Tail background kernel logs]" \
                      "shell[Open interactive console inside sandbox kernel]"
                    ;;
                  skill|s)
                    _values "skill subcommand" \
                      "list[List all available agent skills]" \
                      "add[Add a new skill path]" \
                      "remove[Remove a skill path]" \
                      "enable[Enable a specific skill]" \
                      "disable[Disable a specific skill]"
                    ;;
                  tools|t)
                    _values "tools subcommand" \
                      "list[List all available workspace tools]" \
                      "add[Add a new tool config]" \
                      "remove[Remove a tool config]" \
                      "enable[Enable a specific tool]" \
                      "disable[Disable a specific tool]"
                    ;;
                  update)
                    _values "update subcommand" \
                      "all[Update all sub-projects with latest templates]" \
                      "framework[Update Aura framework from source or remote]" \
                      "merge[Merge template updates with conflict resolution]" \
                      "project[Update a single project by path or name]" \
                      "status[Check template update status for current project]"
                    ;;
                  template)
                    _values "template subcommand" \
                      "diff[Show differences between framework templates and global repo]" \
                      "status[Check template version and sync status]" \
                      "sync[Sync template updates from framework to global repo]"
                    ;;
                esac
                ;;
            esac
          }

          # Setup completion for both 'aura' command and 'ruby -Ilib bin/aura'
          compdef _aura aura
        ZSH
      end

      def bash_completion
        <<~BASH
          _aura() {
              local cur prev opts
              COMPREPLY=()
              cur="${COMP_WORDS[COMP_CWORD]}"
              prev="${COMP_WORDS[COMP_CWORD-1]}"

              commands="add ask branch chat commit config context delete doctor hints info kernel list new prune pull register skill status sync tools tree version web completion h t s k c v i"

              if [ $COMP_CWORD -eq 1 ]; then
                  COMPREPLY=( $(compgen -W "${commands}" -- ${cur}) )
                  return 0
              fi

              case "${prev}" in
                  hints|h)
                      COMPREPLY=( $(compgen -W "list toggle" -- ${cur}) )
                      return 0
                      ;;
                  kernel|k)
                      COMPREPLY=( $(compgen -W "start stop status logs shell" -- ${cur}) )
                      return 0
                      ;;
                  skill|s)
                      COMPREPLY=( $(compgen -W "list add remove enable disable" -- ${cur}) )
                      return 0
                      ;;
                  tools|t)
                      COMPREPLY=( $(compgen -W "list add remove enable disable" -- ${cur}) )
                      return 0
                      ;;
                  update)
                      COMPREPLY=( $(compgen -W "all framework merge status" -- ${cur}) )
                      return 0
                      ;;
                  framework)
                      COMPREPLY=( $(compgen -W "--force --from-git" -- ${cur}) )
                      return 0
                      ;;
                  template)
                      COMPREPLY=( $(compgen -W "diff status sync" -- ${cur}) )
                      return 0
                      ;;
              esac
          }
          complete -F _aura aura
        BASH
      end
    end
  end
end
