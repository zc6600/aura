# frozen_string_literal: true

require "rake/testtask"

# Test task configuration
Rake::TestTask.new(:test) do |t|
  t.libs << "test"
  t.libs << "lib"
  t.pattern = "test/**/test_*.rb"
  t.warning = false
end

# Code coverage task (optional, requires simplecov gem)
desc "Run tests with code coverage"
task :coverage do
  ENV["COVERAGE"] = "true"
  Rake::Task[:test].invoke
end

# Build gem task
desc "Build the aura gem package"
task :build do
  sh "gem build aura.gemspec"
end

# Default task runs tests
task default: :test
