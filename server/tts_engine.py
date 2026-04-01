import os
os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] = "0"
from flask import Flask, request, jsonify
from TTS.api import TTS
import torch

app = Flask(__name__)

print("Loading XTTSv2 into VRAM on RTX 5090...")
# Load using the patched library
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")
print("Model loaded and ready.")

@app.route('/generate', methods=['POST'])
def generate():
    try:
        data = request.json
        tts.tts_to_file(
            text=data['text'],
            speaker_wav=data['speaker_wav'],
            language=data['language'],
            file_path=data['file_path']
        )
        return jsonify({"status": "success"})
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
