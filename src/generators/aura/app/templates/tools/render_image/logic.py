#!/usr/bin/env python3
import os
import sys
import json
import yaml
import requests
from typing import Dict, Any, Optional

# Global configuration path (relative to workspace root)
CONFIG_PATH = "lib/aura/generators/aura/app/templates/config/config.yml"

def load_config() -> Dict[str, Any]:
    """Load global configuration to get image generation settings."""
    try:
        # 1. Try standard config path in workspace
        cfg_path = os.path.join(os.getcwd(), "config", "config.yml")
        if os.path.exists(cfg_path):
            with open(cfg_path, "r") as f:
                return yaml.safe_load(f)

        # 2. Try relative to current working directory
        if os.path.exists("config.yml"):
            with open("config.yml", "r") as f:
                return yaml.safe_load(f)
                
        # 3. Try standard location in aura repo structure if we are in dev mode
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, "r") as f:
                return yaml.safe_load(f)
                
        return {}
    except Exception as e:
        print(f"Warning: Failed to load config.yml: {e}", file=sys.stderr)
        return {}

def get_api_key(env_var_name: str) -> str:
    """Retrieve API key from environment variables."""
    api_key = os.environ.get(env_var_name)
    if not api_key:
        raise ValueError(f"Missing API key environment variable: {env_var_name}")
    return api_key

def generate_openai(prompt: str, size: str, model: str, api_key: str, output_path: str):
    """Generate image using OpenAI DALL-E API."""
    url = "https://api.openai.com/v1/images/generations"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    data = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size
    }
    
    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        raise RuntimeError(f"OpenAI API Error: {response.text}")
        
    result = response.json()
    image_url = result['data'][0]['url']
    
    # Download image
    img_data = requests.get(image_url).content
    with open(output_path, 'wb') as f:
        f.write(img_data)
        
    print(f"Image generated and saved to {output_path}")
    print(json.dumps({"status": "success", "image_path": output_path, "url": image_url}))

def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
        prompt = args.get("prompt")
        output_path = args.get("output_path")
        
        if not prompt or not output_path:
             raise ValueError("Missing required arguments: prompt, output_path")

        # Load configuration
        config = load_config()
        img_config = config.get("image_generation", {})
        
        provider = img_config.get("provider") or "openai"
        model = img_config.get("model") or "dall-e-3"
        size = args.get("size") or img_config.get("size") or "1024x1024"
        api_key_env = img_config.get("api_key_env") or "OPENAI_API_KEY"
        
        # Function dispatch
        if provider == "openai":
            api_key = get_api_key(api_key_env)
            generate_openai(prompt, size, model, api_key, output_path)
        else:
             raise ValueError(f"Unsupported provider: {provider}")
             
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
