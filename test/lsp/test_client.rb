require "minitest/autorun"
require "json"
require "tempfile"
require "aura/ext/lsp/client"

class TestLSPClient < Minitest::Test
  class MockProcess
    attr_reader :stdin, :stdout, :stderr
    def initialize
      @stdin_r, @stdin_w = IO.pipe
      @stdout_r, @stdout_w = IO.pipe
      @stderr_r, @stderr_w = IO.pipe
      @stdin = @stdin_w
      @stdout = @stdout_r
      @stderr = @stderr_r
    end

    def server_stdin; @stdin_r; end
    def server_stdout; @stdout_w; end

    def kill; end
  end

  def setup
    @mock = MockProcess.new
    @client = Aura::LSP::Client.new("mock")
    # Inject mock pipes
    @client.instance_variable_set(:@stdin, @mock.stdin)
    @client.instance_variable_set(:@stdout, @mock.stdout)
    @client.instance_variable_set(:@stderr, @mock.stderr)
    @client.instance_variable_set(:@wait_thr, @mock)
    @client.instance_variable_set(:@running, true)
    
    @client.instance_variable_set(:@reader_thread, Thread.new { @client.send(:listen_loop) })
  end

  def teardown
    @client.stop
  end

  def test_initialize_flow
    # Simulate server response in a background thread
    Thread.new do
      line = @mock.server_stdin.gets("\r\n")
      if line =~ /Content-Length: (\d+)/
        @mock.server_stdin.gets("\r\n") # skip separator
        body = @mock.server_stdin.read($1.to_i)
        msg = JSON.parse(body)
        
        resp = {
          "jsonrpc" => "2.0",
          "id" => msg["id"],
          "result" => { "capabilities" => { "textDocumentSync" => 1 } }
        }
        res_body = JSON.generate(resp)
        @mock.server_stdout.print "Content-Length: #{res_body.bytesize}\r\n\r\n#{res_body}"
        @mock.server_stdout.flush
      end
    end

    # Set initialized manually or via initialize_server
    # Since start() is skipped, we just call initialize_server
    @client.instance_variable_set(:@stdin, @mock.stdin) # Re-ensure for start() skip
    
    # We need to bypass start() in client or make it handle already started
    def @client.start; end 

    res = @client.initialize_server("/tmp")
    assert res && res["result"]
    assert_equal 1, @client.server_capabilities["textDocumentSync"]
  end
end
