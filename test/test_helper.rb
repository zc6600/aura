# frozen_string_literal: true

# Code coverage (only when COVERAGE env var is set)
if ENV["COVERAGE"] == "true"
  require "simplecov"
  SimpleCov.start do
    add_filter "/test/"
    add_filter "/.aura/"
    add_filter "/vendor/"
    
    track_files "lib/**/*.rb"
    
    formatter SimpleCov::Formatter::HTMLFormatter
    minimum_coverage 0  # Set to 80+ when ready to enforce
  end
end

require "minitest/autorun"
require "fileutils"
require "tmpdir"

$LOAD_PATH.unshift File.expand_path("../lib", __dir__)
