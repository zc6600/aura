#!/usr/bin/env ruby
# frozen_string_literal: true

require "sqlite3"
require "json"
require "time"

if __FILE__ == $PROGRAM_NAME
  db_path = ARGV[0]
  unless db_path && File.exist?(db_path)
    puts "Usage: trajectory_viewer.rb <path_to_aura.db>"
    exit 1
  end

  db = SQLite3::Database.new(db_path)

  puts "\n" + "=" * 80
  puts "AURA MISSION TRAJECTORY"
  puts "=" * 80
  printf("%-10s | %-12s | %-20s | %s\n", "TIME", "PHASE", "TOOL", "DETAIL")
  puts "-" * 80

  db.execute("SELECT timestamp, phase, tool, payload FROM events ORDER BY timestamp ASC, id ASC") do |row|
    ts, phase, tool, payload_json = row
    time = Time.at(ts).strftime("%H:%M:%S")
    payload = JSON.parse(payload_json) rescue {}

    detail = case phase
             when "plan"
               p = payload["plan"] || {}
               "Task: #{p["summary"] || p["tool"]}"
             when "execution"
               res = payload["result"] || {}
               status = res["status"] || "ok"
               "Result: #{status.upcase}"
             when "interception"
               "Advice: #{payload["advice"]}"
             else
               ""
             end

    printf("%-10s | %-12s | %-20s | %s\n", time, phase.upcase, tool || "-", detail)
  end
  puts "=" * 80 + "\n"
end
