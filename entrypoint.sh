#!/bin/bash
export TORCH_FORCE_WEIGHTS_ONLY_LOAD=0
set -e

echo "Applying Blackwell-compatible hardware patches..."

# --- THE CRITICAL XTTS PATCH ---
# This finds the exact line in the XTTS model code and forces a legacy load
XTTS_FILE=$(python3 -c "import TTS.tts.models.xtts as xtts; print(xtts.__file__)")
echo "Patching XTTS model at $XTTS_FILE..."
sed -i 's/checkpoint = self.get_compatible_checkpoint_state_dict(model_path)/checkpoint = torch.load(model_path, map_location="cpu", weights_only=False)["model"]/' "$XTTS_FILE"

# Apply the IO patch as a backup
IO_FILE=$(python3 -c "import TTS.utils.io as io; print(io.__file__)")
sed -i 's/weights_only=True/weights_only=False/g' "$IO_FILE" 2>/dev/null || true

# Re-create the engine script (Simplified)
cat <<EOF > /shared/server/tts_engine.py
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
EOF

# Start services
python3 /shared/server/tts_engine.py &
cd /shared/server && npm start