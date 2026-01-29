# frozen_string_literal: true

require "aura/context/errors"
require "aura/context/base"
require "aura/context/directive_provider"
require "aura/context/environment_provider"
require "aura/context/tool_provider"
require "aura/context/state_provider"

module Aura
  module Context
    def self.assemble(project_path, db = nil)
      Base.new(project_path, db).assemble
    end
  end
end
