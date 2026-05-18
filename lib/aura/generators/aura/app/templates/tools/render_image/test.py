import unittest
import json
import os
from unittest.mock import patch, MagicMock
from logic import main

class TestRenderImage(unittest.TestCase):
    
    @patch('logic.load_config')
    @patch('logic.requests.post')
    @patch('logic.requests.get')
    def test_openai_generation(self, mock_get, mock_post, mock_config):
        # Mock Config
        mock_config.return_value = {
            "image_generation": {
                "provider": "openai",
                "model": "dall-e-3",
                "api_key_env": "TEST_API_KEY"
            }
        }
        
        # Mock Environment
        with patch.dict(os.environ, {"TEST_API_KEY": "sk-fake-key"}):
            # Mock API response
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "data": [{"url": "http://example.com/image.png"}]
            }
            mock_post.return_value = mock_response
            
            # Mock Image Download
            mock_img_response = MagicMock()
            mock_img_response.content = b"fake-image-bytes"
            mock_get.return_value = mock_img_response
            
            # Mock Args
            test_args = json.dumps({
                "prompt": "Test Prompt",
                "output_path": "test_output.png"
            })
            
            with patch('sys.argv', ['logic.py', test_args]):
                with patch('builtins.open', unittest.mock.mock_open()) as mock_file:
                    main()
                    # Verify file write
                    mock_file.assert_called_with("test_output.png", "wb")
                    mock_file().write.assert_called_with(b"fake-image-bytes")

if __name__ == '__main__':
    unittest.main()
