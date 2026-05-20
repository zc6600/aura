$LOAD_PATH.unshift File.expand_path("../lib", __dir__)
require "aura/kernel/state"
require "fileutils"
require "sqlite3"

puts "Testing Undo/Redo..."

# Setup
test_dir = File.expand_path("tmp_test_undo_redo", __dir__)
FileUtils.rm_rf(test_dir)
FileUtils.mkdir_p(test_dir)
db_path = File.join(test_dir, "state", "aura.db")
ENV["AURA_STATE_DB_PATH"] = db_path

# Initialize State
state = Aura::Kernel::State.new(test_dir)

# Helper to count events
def count_events(db_path)
  db = SQLite3::Database.new(db_path)
  events = db.get_first_value("SELECT COUNT(*) FROM events")
  undone = db.get_first_value("SELECT COUNT(*) FROM undone_events")
  [events, undone]
end

# 1. Add Turn 1
puts "\n--- Turn 1 ---"
state.record_event({ phase: "user", content: "Hello" })
state.record_event({ phase: "plan", content: "Thinking..." })
state.record_event({ phase: "execution", tool: "test_tool" })

e, u = count_events(db_path)
puts "Events: #{e}, Undone: #{u}"
if e == 3 && u == 0
  puts "✅ Turn 1 recorded"
else
  puts "❌ Turn 1 failed"
  exit 1
end

# 2. Add Turn 2
puts "\n--- Turn 2 ---"
state.record_event({ phase: "user", content: "Do something" })
state.record_event({ phase: "execution", tool: "write_file" })

e, u = count_events(db_path)
puts "Events: #{e}, Undone: #{u}"
if e == 5 && u == 0
  puts "✅ Turn 2 recorded"
else
  puts "❌ Turn 2 failed"
  exit 1
end

# 3. Undo Turn 2
puts "\n--- Undo Turn 2 ---"
res = state.undo_last_turn
puts "Undo result: #{res}"

e, u = count_events(db_path)
puts "Events: #{e}, Undone: #{u}"
if e == 3 && u == 2
  puts "✅ Undo Turn 2 successful"
else
  puts "❌ Undo Turn 2 failed"
  exit 1
end

# 4. Undo Turn 1
puts "\n--- Undo Turn 1 ---"
res = state.undo_last_turn
puts "Undo result: #{res}"

e, u = count_events(db_path)
puts "Events: #{e}, Undone: #{u}"
if e == 0 && u == 5
  puts "✅ Undo Turn 1 successful"
else
  puts "❌ Undo Turn 1 failed"
  exit 1
end

# 5. Redo Turn 1
puts "\n--- Redo Turn 1 ---"
res = state.redo_last_turn
puts "Redo result: #{res}"

e, u = count_events(db_path)
puts "Events: #{e}, Undone: #{u}"
if e == 3 && u == 2
  puts "✅ Redo Turn 1 successful"
else
  puts "❌ Redo Turn 1 failed"
  exit 1
end

# 6. Redo Turn 2
puts "\n--- Redo Turn 2 ---"
res = state.redo_last_turn
puts "Redo result: #{res}"

e, u = count_events(db_path)
puts "Events: #{e}, Undone: #{u}"
if e == 5 && u == 0
  puts "✅ Redo Turn 2 successful"
else
  puts "❌ Redo Turn 2 failed"
  exit 1
end

# Cleanup
FileUtils.rm_rf(test_dir)
puts "\nAll tests passed!"
