# frozen_string_literal: true

# Auto-generate version with timestamp for development builds
# Format: 0.1.0.YYYYMMDDHHMMSS (e.g., 0.1.0.20260522143022)
base_version = "0.1.0"

# Check if building for release (AURA_RELEASE=1) or development
if ENV["AURA_RELEASE"] == "1"
  version = base_version
else
  # Development build: append timestamp to bypass CDN cache
  version = "#{base_version}.#{Time.now.strftime('%Y%m%d%H%M%S')}"
end

Gem::Specification.new do |spec|
  spec.name          = "aura"
  spec.version       = version
  spec.authors       = ["Aura Team"]
  spec.email         = ["support@aura-os.ai"]
  spec.summary       = "AI-native operating system for folder-as-workspace agents."
  spec.homepage      = "https://github.com/aura-os/aura"
  spec.license       = "MIT"
  spec.required_ruby_version = ">= 3.0.0"

  spec.files         = Dir["lib/**/*", "bin/*", "README.md", "docs/**/*"] +
                       Dir["lib/aura/generators/**/*"]
  spec.bindir        = "bin"
  spec.executables   = ["aura"]
  spec.require_paths = ["lib"]

  spec.add_dependency "thor", "~> 1.2"
  spec.add_dependency "sqlite3", "~> 1.6"
end
