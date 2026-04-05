# 🎙️ Universal XTTSv2 API (RTX 50-Series Optimized)
A high-performance clone/derivative of [lojik-ng/docker-tts-api-ui](https://github.com/lojik-ng/docker-tts-api-ui).

A high-performance, containerised Text-to-Speech API using Coqui XTTSv2. This build is specifically patched to support the **NVIDIA Blackwell (RTX 5090/5080)** architecture and PyTorch 2.6+ security layers, ensuring near-instant voice cloning on modern hardware.

---

## 🚀 Features

*   **Persistent Inference**: The model stays resident in VRAM for < 1s generation times.
*   **Blackwell Support**: Custom library patches for RTX 50-series compatibility.
*   **Zero-Shot Cloning**: Clone any voice using a 6-10 second `.wav` sample.
*   **Universal Build**: Automatically scales down to older hardware (e.g., GTX 1080).
*   **Dual-Server Architecture**: Python Flask engine for AI + Node.js Express for API.

---

## 🛠️ Prerequisites

Before cloning, ensure the host machine has:

*   **NVIDIA Drivers**: Latest Game Ready or Studio drivers.
*   **WSL2**: Windows Subsystem for Linux (`wsl --install`).
*   **Docker Desktop**: Configured to use the WSL2 backend.

---

## 📂 Project Structure

```plaintext
.
├── voices/               # Place reference .wav files here
├── models/               # AI model weights (auto-downloaded)
├── server/
│   ├── index.js          # Node.js API Gateway
│   ├── tts_engine.py     # Persistent Python AI Engine
│   └── public/           # Generated audio files
├── Dockerfile            # Blackwell-ready build
└── entrypoint.sh         # Hardware patching & boot logic
```

---

## ⚡ Quick Start

### 1. Prepare your Voices
Place clear `.wav` files of the voice you wish to clone into the `/voices` directory.
- **Single Clip**: Just place a file like `hero.wav`.
- **Multiple Clips (Higher Quality)**: You can improve the cloning quality by providing multiple samples. There are two ways to do this:
    - **Folders**: Create a folder named `voices/hero/` and put all your `.wav` clips inside it.
    - **Prefixes**: Name your files with underscores, e.g., `hero.wav`, `hero_2.wav`, `hero_v3.wav`.
The API will automatically group these and use all available clips to create a more accurate voice profile.

### 2. Build the Image
```powershell
docker build -t my-universal-tts .
```

### 3. Run the Container
Replace `C:\Path\To\Project` with your actual local path.

```powershell
docker run -d -it -p 2902:2902 --gpus all --restart=unless-stopped `
-e TORCH_FORCE_WEIGHTS_ONLY_LOAD=0 `
-v "C:\Path\To\Project:/shared" `
-v "C:\Path\To\Project\models:/root/.local/share/tts" `
-v "/usr/lib/wsl/lib:/usr/lib/wsl/lib:ro" `
--shm-size=8gb `
--name docker-tts-api-ui my-universal-tts
```

---

## 📡 API Usage

### Generate Voice
`POST http://localhost:2902/use-voice`

**Body (JSON):**
```json
{
  "prompt": "The 5090 is officially the king of speech synthesis.",
  "apiKey": "your_key_here",
  "speaker": "hero",
  "language": "en"
}
```

### List Voices
`GET http://localhost:2902/list-voices`

---

## 🔧 Hardware Optimization Notes

### RTX 5090 / 9800X3D
On this hardware, the first request will take ~15 seconds to load the 2GB model into VRAM. Every subsequent request will be near-instant. Use the `--shm-size=8gb` flag to prevent memory bottlenecks between the CPU and GPU.

### GTX 1080 / Older Cards
This build is **"Universal"**. It will detect older CUDA cores and adjust the kernels accordingly. Ensure you have at least 8GB of VRAM available for stable performance.

---

## ⚠️ Troubleshooting

1.  **GPU not "touching" the workload?** Ensure you are passing the `/usr/lib/wsl/lib` volume mount. This is required for Docker to see the Blackwell drivers on Windows.
2.  **AttributeError / Pickle Errors**: These are handled by the `entrypoint.sh` patches. If they persist, ensure `TORCH_FORCE_WEIGHTS_ONLY_LOAD=0` is set in your environment.
3.  **Robotic Audio**: Check your reference `.wav` file. It should be clean, mono, and roughly 10 seconds long.

---

## 📄 License

This project is for educational/personal use. Please adhere to the Coqui TTS and Model licenses regarding commercial usage and ethical AI voice cloning.

---

## 📝 .gitignore Recommendation

```plaintext
node_modules/
models/
public/*.wav
public/*.mp3
logs/*.log
keys.json
.DS_Store
```
