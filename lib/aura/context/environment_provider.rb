# frozen_string_literal: true

require "time"

module Aura
  module Context
    class EnvironmentProvider
      def initialize(path)
        @path = path
        @knowledge_path = File.join(path, "knowledge")
      end

      def provide
        section = ["# SYSTEM & ENVIRONMENT"]

        readme = File.join(@path, "AURA_README.md")
        section << "## Global Rules\n#{File.read(readme)}" if File.exist?(readme)

        magic_hints = scan_all_magic_hints
        section << "## Active Tags & Guidance\n#{magic_hints}" unless magic_hints.empty?

        knowledge_index = build_knowledge_index
        section << "## Knowledge Assets\n#{knowledge_index}" if knowledge_index

        section.join("\n\n")
      end

      private
        def scan_all_magic_hints
          hints = []
          Dir.glob(File.join(@path, "**", "*.{py,rb,sh,md,txt}")) do |file|
            next if file.include?("/.git/") || file.include?("/state/")
            rel_path = file.sub(/^#{Regexp.escape(@path)}\//, "")
            begin
              File.open(file, "r") do |f|
                15.times do
                  line = f.gets
                  break unless line
                  if line =~ /@aura-hint:\s*(.*)/
                    hints << "- [From #{rel_path}]: #{$1.strip}"
                  end
                end
              end
            rescue StandardError
              next
            end
          end
          hints.join("\n")
        end

        def build_knowledge_index
          kp = File.join(@path, "knowledge")
          return nil unless Dir.exist?(kp)
          Dir.glob(File.join(kp, "**", "*")).map do |f|
            next if File.directory?(f) || f.end_with?(".hint")
            rel = f.sub(/^#{Regexp.escape(kp)}\//, "")
            hint_path = f + ".hint"
            hint = File.exist?(hint_path) ? " (Context: #{File.read(hint_path).strip})" : ""
            "- #{rel}#{hint}"
          end.compact.join("\n")
        end
    end
  end
end
