# frozen_string_literal: true

require "thor"
require "fileutils"
require "yaml"

module Aura
  module Commands
    class ConfigCommand < Thor
      default_task :config

      def self.exit_on_failure?
        true
      end

      desc "[KEY] [VALUE]", "Read or write configuration settings"
      method_option :global, type: :boolean, aliases: "-g", desc: "Target the global template repository config"
      def config(key = nil, value = nil)
        is_global = options[:global] || options["global"]
        cfg_path = if is_global
                     Aura::PathResolver.resolve_config_path(Aura::GlobalConfig.repo_path)
                   else
                     aura_dir = find_aura_dir
                     if aura_dir.nil?
                       puts "\e[31m⛔️ Error: Not in an Aura workspace.\e[0m"
                       puts "To configure globally, use the --global flag."
                       puts "To initialize a workspace in the current directory, run:"
                       puts "  $ aura new"
                       exit 1
                     end
                     Aura::PathResolver.resolve_config_path(aura_dir)
                   end

        cfg_dir = File.dirname(cfg_path)
        FileUtils.mkdir_p(cfg_dir) unless File.directory?(cfg_dir)

        hash = File.exist?(cfg_path) ? (YAML.load_file(cfg_path) || {}) : {}

        if key.nil?
          # List all config
          puts YAML.dump(hash)
        elsif value.nil?
          # Read a single key
          val = get_hash_value(hash, key)
          if val.nil?
            puts "\e[33m(nil)\e[0m"
          else
            puts val
          end
        else
          set_hash_value(hash, key, value)
          File.write(cfg_path, YAML.dump(hash))
          is_global = options[:global] || options["global"]
          puts "\e[32mSuccessfully updated #{key} to #{value} in #{is_global ? 'global' : 'local'} config.\e[0m"
        end
      end

      private

      def find_aura_dir
        Aura::PathResolver.find_aura_dir(Dir.pwd)
      end

      def get_hash_value(hash, key)
        parts = key.split(".")
        curr = hash
        parts.each do |p|
          return nil unless curr.is_a?(Hash)

          curr = curr[p] || curr[p.to_s]
        end
        curr
      end

      def set_hash_value(hash, key, value)
        parts = key.split(".")
        curr = hash
        parts[0...-1].each do |p|
          curr[p] = {} unless curr[p].is_a?(Hash)
          curr = curr[p]
        end

        # Parse value type
        parsed_val = case value
                     when "true"
                       true
                     when "false"
                       false
                     when /\A\d+\z/
                       value.to_i
                     when /\A\d*\.\d+\z/
                       value.to_f
                     else
                       value
                     end
        curr[parts.last] = parsed_val
      end
    end
  end
end
