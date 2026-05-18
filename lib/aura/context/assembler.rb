# frozen_string_literal: true

module Aura
  module Context
    def self.assemble(project_path, db = nil, options = {})
      Base.new(project_path, db, options).assemble
    end
  end
end
