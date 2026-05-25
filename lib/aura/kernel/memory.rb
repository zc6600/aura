# frozen_string_literal: true

#
# Aura::Kernel::Memory
#
# This is intentionally minimal - Memory is now primarily available as:
#   - Aura::Memory (independent module, fully decoupled)
#
# For architectural reasons, the Memory module is intentionally
# at the top-level to maintain its independence from Kernel layer.
#
# Usage:
#   require "aura/memory"
#   config = Aura::Memory::Config.new(store: { project_path: path })
#   memory = Aura::Memory::Base.new(config: config)
#
# Or if you want the Kernel prefix, just use:
#   memory = Aura::Memory::Base.new(...)
#

require "aura/memory"

module Aura
  module Kernel
    Memory = ::Aura::Memory
  end
end
