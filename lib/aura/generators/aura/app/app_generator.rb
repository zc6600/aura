# frozen_string_literal: true

require "aura/generators/app_base"

module Aura
  module ActionMethods # :nodoc:
    attr_reader :options

    def initialize(generator)
      @generator = generator
      @options   = generator.options
    end

    private
      %w(template copy_file directory empty_directory inside
         empty_directory_with_keep_file create_file chmod shebang).each do |method|
        class_eval <<-RUBY, __FILE__, __LINE__ + 1
          def #{method}(...)
            @generator.send(:#{method}, ...)
          end
        RUBY
      end

      def method_missing(...)
        @generator.send(...)
      end
  end

  # The application builder allows you to override elements of the application
  # generator without being forced to reverse the operations of the default
  # generator.
  class AppBuilder
    include ActionMethods

    def gemfile
      template "Gemfile"
    end

    def task
      template "task.md", "task.md"
    end

    def tools
      directory "tools"
    end

    def knowledge
      empty_directory "knowledge"
    end

    def skills
      directory "skills"
    end

    def anchors
      empty_directory "anchors"
      template "anchors/README.md", "anchors/README.md"
    end

    def projects
      empty_directory "projects"
    end

    def config
      empty_directory "config"
      template "config.yml", "config/config.yml"
      template "boot.rb", "config/boot.rb"
      template "Dockerfile.sandbox", "Dockerfile.sandbox"
    end

    def bin
      empty_directory "bin"
      template "bin/aura", "bin/aura"
      chmod "bin/aura", 0755, verbose: false
      template "sandbox-wrapper.sh", "bin/sandbox-wrapper"
      chmod "bin/sandbox-wrapper", 0755, verbose: false
    end

    def readme
      template "AURA_README.md", "AURA_README.md"
    end

    def instructions
      empty_directory "instructions"
      template "instructions/SOUL.md", "instructions/SOUL.md"
      template "instructions/AGENTS.md", "instructions/AGENTS.md"
      template "instructions/USER.md", "instructions/USER.md"
      template "instructions/TOOLS.md", "instructions/TOOLS.md"
    end
  end

  module Generators
    class AppGenerator < AppBase
      # :stopdoc:

      add_shared_options_for "application"

      argument :app_path, type: :string

      def self.source_root
        File.expand_path("templates", __dir__)
      end

      def create_root
        self.destination_root = File.expand_path(app_path, destination_root)
        empty_directory "."
      end

      def create_root_files
        build(:gemfile)
        build(:task)
        build(:instructions)
      end

      def create_app_files
        build(:tools)
        build(:knowledge)
        build(:skills)
        build(:anchors)
        build(:projects)
      end

      def create_config_files
        build(:config)
      end

      def create_bin_files
        build(:bin)
      end

      def create_readme
        build(:readme)
      end

      def apply_project_template
        name = options[:project_template]
        return if name.nil? || name.to_s.strip.empty?
        template_root = File.join(self.class.source_root, "projects", name.to_s)
        unless File.directory?(template_root)
          raise Thor::Error, "Project template '#{name}' not found. Available: #{available_project_templates.join(', ')}"
        end
        directory File.join("projects", name.to_s), "."
      end

      private
        def build(method, *args)
          builder.send(method, *args)
        end

        def builder
          @builder ||= AppBuilder.new(self)
        end

        def available_project_templates
          root = File.join(self.class.source_root, "projects")
          return [] unless Dir.exist?(root)
          Dir.children(root).select { |f| File.directory?(File.join(root, f)) }.sort
        rescue StandardError
          []
        end
    end
  end
end
