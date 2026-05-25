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

# Changelog tasks
namespace :changelog do
  desc "Generate changelog from git commits (usage: rake changelog:generate[version,date])"
  task :generate, [:version, :date] do |_t, args|
    args.with_defaults(version: "Unreleased", date: Time.now.strftime("%Y-%m-%d"))
    sh "ruby scripts/generate_changelog.rb #{args[:version]} #{args[:date]}"
  end

  desc "Print changelog to stdout for preview"
  task :preview, [:version, :date] do |_t, args|
    args.with_defaults(version: "Unreleased", date: Time.now.strftime("%Y-%m-%d"))
    sh "ruby scripts/generate_changelog.rb #{args[:version]} #{args[:date]} --print"
  end

  desc "Validate CHANGELOG.md format"
  task :validate do
    unless File.exist?("CHANGELOG.md")
      abort "ERROR: CHANGELOG.md not found"
    end

    content = File.read("CHANGELOG.md")
    
    unless content.include?("## [Unreleased]")
      puts "WARNING: Missing [Unreleased] section"
    end

    unless content.include?("Keep a Changelog")
      puts "WARNING: Not following Keep a Changelog format"
    end

    puts "✓ CHANGELOG.md validated"
  end
end

# Default task runs tests
task default: :test
