#!/usr/bin/env ruby
# frozen_string_literal: true

# CHANGELOG generator from git commits
# Usage: ruby scripts/generate_changelog.rb [version] [date]
# Example: ruby scripts/generate_changelog.rb 0.2.0 2026-06-01

require "open3"

class ChangelogGenerator
  CATEGORIES = {
    feat: "Added",
    fix: "Fixed",
    docs: "Documentation",
    style: "Changed",
    refactor: "Changed",
    test: "Changed",
    chore: "Changed",
    security: "Security",
    perf: "Performance"
  }.freeze

  def initialize(version = nil, date = nil)
    @version = version || "Unreleased"
    @date = date || Time.now.strftime("%Y-%m-%d")
    @commits = fetch_commits
  end

  def generate
    output = []
    output << "## [#{@version}] - #{@date}"
    output << ""

    categorized = categorize_commits

    CATEGORIES.each do |type, category|
      commits = categorized[type]
      next if commits.empty?

      output << "### #{category}"
      commits.each do |commit|
        output << "- #{commit[:message]}"
      end
      output << ""
    end

    output.join("\n")
  end

  def save_to_changelog(changelog_path = "CHANGELOG.md")
    new_entry = generate
    
    unless File.exist?(changelog_path)
      File.write(changelog_path, "# Changelog\n\n")
    end

    content = File.read(changelog_path)
    
    # Insert after the Unreleased section or at the beginning
    if content.include?("## [Unreleased]")
      # Find the position after the Unreleased section
      lines = content.lines
      insert_index = nil
      
      lines.each_with_index do |line, index|
        if line.start_with?("## [") && index > 0
          insert_index = index
          break
        end
      end
      
      if insert_index
        lines.insert(insert_index, "\n---\n\n", new_entry, "\n")
        File.write(changelog_path, lines.join)
      else
        File.write(changelog_path, content + "\n---\n\n" + new_entry + "\n")
      end
    else
      # Prepend to existing content
      File.write(changelog_path, "# Changelog\n\n" + new_entry + "\n\n---\n\n" + content.sub(/^# Changelog\n\n/, ""))
    end

    puts "✓ Changelog updated for version #{@version}"
  end

  private

  def fetch_commits
    # Get commits since last tag, or all commits if no tags
    last_tag, _ = Open3.capture2("git describe --tags --abbrev=0 2>/dev/null")
    last_tag = last_tag.strip
    
    range = last_tag.empty? ? "HEAD" : "#{last_tag}..HEAD"
    
    output, status = Open3.capture2("git log #{range} --pretty=format:'%H %s'")
    return [] unless status.success?

    output.lines.map do |line|
      hash, message = line.strip.split(" ", 2)
      { hash: hash, message: message }
    end
  end

  def categorize_commits
    categorized = Hash.new { |h, k| h[k] = [] }

    @commits.each do |commit|
      message = commit[:message]
      
      # Parse conventional commit format: type: description
      if message =~ /^(\w+)(\(.+\))?:\s+(.+)/
        type = $1.to_sym
        description = $3
        
        # Skip chore commits for minor changes
        next if type == :chore && description =~ /merge|version bump/i
        
        categorized[type] << {
          message: description.capitalize,
          hash: commit[:hash][0..7]
        }
      else
        # Non-conventional commits go to Changed
        categorized[:chore] << {
          message: message.capitalize,
          hash: commit[:hash][0..7]
        }
      end
    end

    categorized
  end
end

# CLI usage
if __FILE__ == $0
  version = ARGV[0]
  date = ARGV[1]
  
  generator = ChangelogGenerator.new(version, date)
  
  if ARGV.include?("--print")
    puts generator.generate
  else
    generator.save_to_changelog
  end
end
