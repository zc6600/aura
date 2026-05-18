require "minitest/autorun"
require "socket"
require "json"
require "net/http"
require "uri"
require "fileutils"

class TestAgentResultsWeb < Minitest::Test
  def setup
    @app = File.join(Dir.pwd, "tmp_agent_web")
    FileUtils.rm_rf(@app)
    system("ruby bin/aura new tmp_agent_web")
    require "aura/cli/commands/kernel_command"
    payload = { tool: "read_file", args: { file_path: "config/config.yml", context_permissions: ["."] } }.to_json
    Aura::Commands::KernelCommand.start(["once", @app, "-c", payload])
  end

  def teardown
    if @web_pid
      begin
        Process.kill("TERM", @web_pid)
      rescue Errno::ESRCH
      end
    end
    FileUtils.rm_rf(@app)
  end

  def test_web_serves_events
    begin
      require "sqlite3"
    rescue LoadError
      skip "sqlite3 not available"
    end

    # Find a free port
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    server.close

    @web_pid = Process.spawn(
      "ruby", "bin/aura", "web", @app, "--port", port.to_s, "--host", "127.0.0.1",
      out: File::NULL, err: File::NULL
    )
    wait_for_port(port)
    uri = URI("http://localhost:#{port}/events")
    out = Net::HTTP.get(uri)
    data = JSON.parse(out)
    assert_includes data["tail"], "phase"
    Net::HTTP.get(URI("http://localhost:#{port}/shutdown"))
    begin
      Process.wait(@web_pid)
    rescue Errno::ECHILD, Errno::ESRCH
    end
  end

  private

  def wait_for_port(port)
    100.times do
      begin
        socket = TCPSocket.new("127.0.0.1", port)
        socket.close
        return
      rescue Errno::ECONNREFUSED, Errno::EHOSTUNREACH
        sleep 0.1
      end
    end
    raise "web server did not start on port #{port}"
  end
end
