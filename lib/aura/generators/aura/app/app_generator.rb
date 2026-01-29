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

    def tools
      directory "tools"
    end

    def config
      empty_directory "config"
      template "config.yml", "config/config.yml"
    end

    def bin
      empty_directory "bin"
      template "bin/aura", "bin/aura"
      chmod "bin/aura", 0755
    end

    def readme
      template "AURA_README.md", "AURA_README.md"
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
      end

      def create_app_files
        build(:tools)
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

      private
        def build(method, *args)
          builder.send(method, *args)
        end

        def builder
          @builder ||= AppBuilder.new(self)
        end
    end
  end
end
