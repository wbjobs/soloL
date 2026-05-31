import json
import sys
import os
from midi_parser import parse_midi, analysis_to_dict
from music_classifier import classify_music

def main():
    try:
        input_raw = sys.stdin.readline().strip()
        if not input_raw:
            input_raw = sys.stdin.read().strip()
        
        input_data = json.loads(input_raw)
        if isinstance(input_data, str):
            input_data = json.loads(input_data)
            
        file_path = input_data.get('file_path')
        
        if not file_path or not os.path.exists(file_path):
            raise ValueError(f"Invalid file path: {file_path}")
        
        midi_analysis = parse_midi(file_path)
        midi_dict = analysis_to_dict(midi_analysis)
        
        classification = classify_music(midi_dict)
        
        result = {
            'midi_analysis': midi_dict,
            'classification': classification,
            'success': True
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
