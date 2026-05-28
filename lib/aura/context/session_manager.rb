# frozen_string_literal: true

# Backward-compatibility shim: SessionManager now lives in Aura::Memory.
# This file is kept so any existing `require "aura/context/session_manager"` calls
# continue to work without modification. New code should use:
#
#   require "aura/memory/session_manager"
#   Aura::Memory::SessionManager
#
require "aura/memory/session_manager"

module Aura
  module Context
    # @deprecated Use Aura::Memory::SessionManager instead
    SessionManager = Aura::Memory::SessionManager
  end
end
