# frozen_string_literal: true

# Set up gems listed in the Gemfile.
ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)

require "bundler/setup" if File.exist?(ENV["BUNDLE_GEMFILE"])

$LOAD_PATH.unshift File.expand_path("../lib", __dir__)

# Add Aura framework to load path if it's not installed as a gem
# During development, we link to the local Aura source
aura_lib = File.expand_path("../../lib", __dir__) 
$LOAD_PATH.unshift(aura_lib) if Dir.exist?(File.join(aura_lib, "aura"))
