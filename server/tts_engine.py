import os
os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] = "0"
from flask import Flask, request, jsonify
from TTS.api import TTS
import torch

app = Flask(__name__)

print("Loading XTTSv2 into VRAM on RTX 5090...")
# Enable GPU and deepspeed if possible for Blackwell
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")
print("Model loaded and ready.")

@app.route('/generate', methods=['POST'])
def generate():
    try:
        data = request.json
        
        # Pull parameters from request or use these high-quality defaults
        tts.tts_to_file(
            text=data['text'],
            speaker_wav=data['speaker_wav'],
            language=data['language'],
            file_path=data['file_path'],
            
            # --- QUALITY TWEAKS ---
            temperature=0.65,       # Higher = more emotive, Lower = more stable. 0.75 is the sweet spot.
            length_penalty=1.0,     # Controls how much the model prefers longer/shorter breaths.
            repetition_penalty=5.0, # Prevents the AI from getting stuck on words or "looping."
            top_k=50,               # Limits the AI to the top 50 most likely "next sounds."
            top_p=0.85,             # Nucleus sampling; filters out the "noisy" tail of possibilities.
            speed=1.0,              # 1.0 is natural. 0.95 can sometimes sound more "authoritative."
            enable_text_splitting=True # Better for long sentences to prevent the AI from losing the voice.
        )
        
        return jsonify({"status": "success"})
    except Exception as e:
        print(f"Inference Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)