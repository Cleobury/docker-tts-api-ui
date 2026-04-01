FROM ghcr.io/coqui-ai/tts

# Install system dependencies + the missing NVIDIA NPP libraries for CUDA 12.8
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    libnpp-12-8 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -sL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs

# --- THE UNIVERSAL BRIDGE (5090 + 1080) ---
RUN pip3 install --no-cache-dir --upgrade torch torchaudio torchcodec --index-url https://download.pytorch.org/whl/cu128

# --- THE PICKLE PATCH (Fixed Path) ---
RUN export TTS_PATH=$(python3 -c "import TTS; print(TTS.__path__[0])") && \
    sed -i "1s/^/import torch; torch.serialization.add_safe_globals([\"TTS.tts.configs.xtts_config.XttsConfig\"])\n/" "$TTS_PATH/utils/io.py"

WORKDIR /shared
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]