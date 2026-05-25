# frozen_string_literal: true

require "aura"
require "yaml"

module Aura
  module ConfigLoader
    class ConfigError < StandardError; end
    class FileNotFoundError < ConfigError; end
    class ParseError < ConfigError; end

    def self.load(project_path_or_env_path, options = {})
      path = resolve_config_path(project_path_or_env_path)

      if path.nil? || path.to_s.strip.empty?
        return options[:required] ? raise(ConfigError, "Config path could not be resolved") : {}
      end

      unless File.exist?(path)
        return options[:required] ? raise(FileNotFoundError, "Config file not found: #{path}") : {}
      end

      if options[:safe]
        Aura.safe_load_yaml(path)
      else
        YAML.load_file(path) || {}
      end
    rescue Psych::SyntaxError => e
      raise ParseError, "Invalid YAML in #{path}: #{e.message}"
    rescue Errno::ENOENT => e
      raise FileNotFoundError, "Cannot read config file: #{path} - #{e.message}"
    rescue IOError => e
      raise ConfigError, "IO error reading config: #{e.message}"
    end

    def self.resolve_config_path(project_path_or_env_path)
      Aura::PathResolver.resolve_config_path(project_path_or_env_path)
    end

    def self.load_with_fallback(primary_path, fallback_path = nil)
      load(primary_path, safe: true)
    rescue FileNotFoundError
      return {} if fallback_path.nil?

      load(fallback_path, safe: true)
    rescue ConfigError
      {}
    end

    module ClassMethods
      def config_loader_path
        @config_loader_path ||= nil
      end

      def config_loader_path=(path)
        @config_loader_path = path
      end

      def load_config(options = {})
        path = options[:path] || config_loader_path || env_path || project_path
        Aura::ConfigLoader.load(path, options)
      end
    end

    def load_config(options = {})
      Aura::ConfigLoader.load(self.class.config_loader_path || env_path || project_path, options)
    end
  end
end
