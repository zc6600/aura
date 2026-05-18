import unittest
import json
from unittest.mock import patch, MagicMock
from logic import main

class TestOCRAndVerify(unittest.TestCase):
    
    @patch('logic.Image.open')
    @patch('logic.pytesseract.image_to_string')
    def test_ocr_verification(self, mock_ocr, mock_open):
        # Mock OCR result
        mock_ocr.return_value = "This is a Test Diagram with Node A and Node B."
        
        # Test Case 1: All found
        test_args = json.dumps({
            "image_path": "test.png",
            "expected_texts": ["Node A", "Node B"]
        })
        
        with patch('sys.argv', ['logic.py', test_args]):
            with patch('builtins.print') as mock_print:
                main()
                args, _ = mock_print.call_args
                output = json.loads(args[0])
                self.assertTrue(output['verification']['all_found'])
                self.assertTrue(output['verification']['details']['Node A'])

    @patch('logic.Image.open')
    @patch('logic.pytesseract.image_to_string')
    def test_ocr_failure(self, mock_ocr, mock_open):
        # Mock OCR result
        mock_ocr.return_value = "Only Node A is here."
        
        # Test Case 2: Missing text
        test_args = json.dumps({
            "image_path": "test.png",
            "expected_texts": ["Node A", "Node B"]
        })
        
        with patch('sys.argv', ['logic.py', test_args]):
            with patch('builtins.print') as mock_print:
                main()
                args, _ = mock_print.call_args
                output = json.loads(args[0])
                self.assertFalse(output['verification']['all_found'])
                self.assertFalse(output['verification']['details']['Node B'])

if __name__ == '__main__':
    unittest.main()
