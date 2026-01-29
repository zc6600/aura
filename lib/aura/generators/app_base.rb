# frozen_string_literal: true

require "thor"

module Aura
  module Generators
    class AppBase < Thor::Group
      include Thor::Actions

      def self.add_shared_options_for(name)
        class_option :template, type: :string, aliases: "-m", desc: "Path to some application template (can be a filesystem path or URL)"
        class_option :skip_git, type: :boolean, aliases: "-G", default: nil, desc: "Skip git init, .gitignore and .gitattributes"
        class_option :quiet, type: :boolean, aliases: "-q", default: nil, desc: "Suppress status output"
        class_option :force, type: :boolean, aliases: "-f", default: nil, desc: "Overwrite files that already exist"
        class_option :pretend, type: :boolean, aliases: "-p", default: nil, desc: "Run but do not make any changes"
      end
    end
  end
end
