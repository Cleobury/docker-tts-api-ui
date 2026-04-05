#!/bin/bash
export TORCH_FORCE_WEIGHTS_ONLY_LOAD=0
set -e

echo "-------------------------------------------------------"
echo "Starting Universal TTS Engine (Blackwell-Optimised)"
echo "-------------------------------------------------------"

# 0. ENSURE NODE DEPENDENCIES ARE INSTALLED
echo "Synchronizing Node.js dependencies..."
cd /shared/server && npm install

# 1. THE CRITICAL XTTS PATCH
# This finds the exact line in the XTTS model code and forces a legacy load
XTTS_FILE=$(python3 -c "import TTS.tts.models.xtts as xtts; print(xtts.__file__)")
echo "Patching XTTS model at $XTTS_FILE..."
sed -i 's/checkpoint = self.get_compatible_checkpoint_state_dict(model_path)/checkpoint = torch.load(model_path, map_location="cpu", weights_only=False)["model"]/' "$XTTS_FILE"

# 2. THE IO PATCH (Backup)
IO_FILE=$(python3 -c "import TTS.utils.io as io; print(io.__file__)")
echo "Applying IO security bypass to $IO_FILE..."
sed -i 's/weights_only=True/weights_only=False/g' "$IO_FILE" 2>/dev/null || true

# 3. START THE PERSISTENT ENGINE
# We no longer 're-create' the file. We just run the one you saved in /server/
echo "Launching Python Engine from /shared/server/tts_engine.py..."
python3 /shared/server/tts_engine.py &

# 4. START NODE SERVER
echo "Starting Node.js API Gateway..."
cd /shared/server && npm start