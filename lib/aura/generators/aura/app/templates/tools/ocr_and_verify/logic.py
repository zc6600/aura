#!/usr/bin/env python3
import sys
import json
import pytesseract
from PIL import Image
from typing import List

def extract_text(image_path: str) -> str:
    """Extract text from an image using Tesseract OCR."""
    try:
        image = Image.open(image_path)
        text = pytesseract.image_to_string(image)
        return text
    except Exception as e:
        raise RuntimeError(f"OCR failed: {e}")

def verify_content(extracted_text: str, expected_texts: List[str]) -> dict:
    """Verify if expected text segments are present in the extracted text."""
    results = {}
    all_found = True
    
    # Normalize for comparison (basic)
    normalized_extracted = extracted_text.lower().replace("\n", " ")
    
    for expected in expected_texts:
        normalized_expected = expected.lower()
        if normalized_expected in normalized_extracted:
            results[expected] = True
        else:
            results[expected] = False
            all_found = False
            
    return {"all_found": all_found, "details": results}

def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
        image_path = args.get("image_path")
        expected_texts = args.get("expected_texts", [])
        
        if not image_path:
             raise ValueError("Missing required argument: image_path")

        # 1. OCR
        extracted_text = extract_text(image_path)
        
        # 2. Verify
        verification_result = verify_content(extracted_text, expected_texts)
        
        # Output
        print(json.dumps({
            "status": "success", 
            "extracted_text": extracted_text,
            "verification": verification_result
        }))
             
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
