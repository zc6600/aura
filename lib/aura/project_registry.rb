# frozen_string_literal: true

require "fileutils"

module Aura
  # Project registry management (global)
  module ProjectRegistry
    def self.config_path
      if defined?(Aura) && Aura.respond_to?(:global_projects_config_path)
        Aura.global_projects_config_path
      else
        File.join(Dir.home, ".aura", "projects.yml")
      end
    end

    # Retrieve all registered projects as a Hash mapping name to absolute path
    def self.registered_projects
      cfg_path = config_path
      return {} unless File.exist?(cfg_path)
      begin
        require "yaml"
        data = YAML.load_file(cfg_path)
        data.is_a?(Hash) && data["projects"] ? data["projects"] : {}
      rescue StandardError
        {}
      end
    end

    # Register a workspace path with a project name globally
    def self.register!(name, path)
      cfg_path = config_path
      FileUtils.mkdir_p(File.dirname(cfg_path))
      begin
        require "yaml"
        data = File.exist?(cfg_path) ? (YAML.load_file(cfg_path) || {}) : {}
      rescue StandardError
        data = {}
      end
      data = {} unless data.is_a?(Hash)
      data["projects"] ||= {}
      data["projects"][name.to_s] = File.expand_path(path)
      File.write(cfg_path, YAML.dump(data))
    end

    # Unregister a project name globally
    def self.unregister!(name)
      cfg_path = config_path
      return false unless File.exist?(cfg_path)
      begin
        require "yaml"
        data = YAML.load_file(cfg_path) || {}
      rescue StandardError
        return false
      end
      data = {} unless data.is_a?(Hash)
      data["projects"] ||= {}
      if data["projects"].delete(name.to_s)
        File.write(cfg_path, YAML.dump(data))
        true
      else
        false
      end
    end
  end
end
