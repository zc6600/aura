# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name          = "aura"
  spec.version       = "0.1.0"
  spec.authors       = ["Aura Team"]
  spec.email         = ["support@aura-os.ai"]
  spec.summary       = "AI-native operating system for folder-as-workspace agents."
  spec.homepage      = "https://github.com/aura-os/aura"
  spec.license       = "MIT"
  spec.required_ruby_version = ">= 3.0.0"

  spec.files         = Dir["lib/**/*.rb", "bin/*", "README.md", "docs/**/*"]
  spec.bindir        = "bin"
  spec.executables   = ["aura"]
  spec.require_paths = ["lib"]

  spec.add_dependency "thor", "~> 1.2"
  spec.add_dependency "sqlite3", "~> 1.6"
end
