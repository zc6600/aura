# frozen_string_literal: true
#
# Memory::PathResolver - Resolve database paths from project configuration
#
# This is extracted from SQLiteStore to maintain separation of concerns.
# Session management and path resolution should not be part of the low-level Store.
#

require "fileutils"

module Aura
  module Memory
    class PathResolver
      def self.resolve(config)
        if config[:db_path]
          File.expand_path(config[:db_path])
        else
          project_path = config[:project_path] || "."
          resolve_session_db_path(project_path)
        end
      end

      def self.resolve_session_db_path(project_path)
        Aura::PathResolver.session_db_path(project_path)
      end
    end
  end
end
