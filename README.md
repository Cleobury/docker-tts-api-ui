# 🎙️ AI-Voice-Cloner (Blackwell Edition)
A high-performance Text-to-Speech & Audio Enhancement suite optimized for **NVIDIA Blackwell (RTX 5090/5080)** and modern AI workflows.

---

## 🚀 Key Features

*   **Neural Calibration**: Real-time tuning of **Creativity** (Temperature), **Stability** (Repetition Penalty), and **Pace** (Speed) directly from the dashboard.
*   **High-Fidelity Isolation**: Built-in **UVR-MDX-NET** vocal separation patched with native Blackwell kernels (`torchvision::nms`) for ultra-fast audio cleaning.
*   **Smart Neural Uploader**: Integrated file management with **Auto-Ranking** logic—simply upload a file, and the system numbers it correctly (e.g., `Adam_1` -> `Adam_2`).
*   **Persistent Inference**: XTTSv2 model stays resident in VRAM for synthesis in < 1 second.
*   **Clean Lab Logic**: Intelligent prefix-based grouping ensures all related clips and baked models appear under a single, professional speaker profile.
*   **Universal Build**: Automatically scales and patches itself for everything from a GTX 1080 to an RTX 5090.

---

## 🛠️ Prerequisites

*   **NVIDIA Drivers**: Latest Game Ready or Studio drivers.
*   **WSL2**: Windows Subsystem for Linux (`wsl --install`).
*   **Docker Desktop**: Configured with the WSL2 backend and GPU support.

---

## 📂 Project Organization

```plaintext
.
├── voices/               # Main Voice Bank (Clips & Baked Models)
│   └── instrumental/     # Auto-archived background tracks (hidden from app)
├── models/               # AI model weights (auto-downloaded)
├── server/
│   ├── index.js          # Node.js API Gateway (Express)
│   ├── tts_engine.py     # Blackwell-Patched Python AI Engine (Flask)
│   └── public/           # Dashboard & Asset hosting
├── Dockerfile            # Optimized CUDA 12.8 / PyTorch 2.11 Layer
└── entrypoint.sh         # Dynamic dependency & hardware patching logic
```

---

## ⚡ Quick Start

### 1. One-Click Build & Launch
For the fastest setup, use the included automation scripts:
- **Windows (PowerShell)**: `. 'rebuild.ps1'`
- **Linux / WSL2 (Bash)**: `chmod +x rebuild.sh && ./rebuild.sh`

These scripts handle stopping existing containers, rebuilding the Blackwell-optimized image, and launching the dashboard at `http://localhost:2902`.

#### Manual Deployment (Reference)
```powershell
docker build -t ai-voice-cloner .
docker run -d -it -p 2902:2902 --gpus all --restart=unless-stopped `
-v "C:\Path\To\Project:/shared" `
--shm-size=8gb --name ai-voice-cloner ai-voice-cloner
```

### 2. The Neural Uploader (Recommended)
Once the dashboard is running at `http://localhost:2902`, navigate to the **Voice Lab** tab:
- **Drop & Sync**: Use the **Neural Upload** card to select an audio sample.
- **Auto-Register**: Enter a speaker name (e.g., "Adam"). 
- **Smart Ranking**: The system automatically numbers the file (e.g., `Adam_1.wav`) and adds it to the speaker's profile in real-time.

### 3. Manual Preparation (Legacy/Batch)
If you have a large library, you can still batch-copy files into the `/voices` directory.
- **Prefix Grouping**: Name files like `hero_1.wav`, `hero_2.wav`. The engine will group them under a single "hero" profile based on the text before the underscore.

---

## 📡 API & Dashboard

### Integrated Dashboard
Access the high-contrast dashboard at `http://localhost:2902`. 
- **Synthesis Engine**: Featuring real-time **Neural Calibration** sliders for advanced creative control.
- **Vocal Lab**: Unified view of all voice profiles, clips, and baked models.
- **Neural Enhancer**: One-click **Vocal Isolation** and **Denoising** powered by Blackwell kernels.

### Interactive API Documentation (Swagger)
The engine includes a full **Swagger UI** for developers and power users to test endpoints directly.
- **Documentation URL**: `http://localhost:2902/api-docs`
- **Definition Source**: All API endpoints and schemas are defined in [server/index.js](server/index.js).

### Synthesis Parameters (POST /use-voice)
| Parameter | Description | Recommended |
| :--- | :--- | :--- |
| `temperature` | **Creativity**: Higher = more expressive, Lower = robotic. | 0.65 - 0.75 |
| `repetition_penalty` | **Stability**: Prevents "looping" or stuttering. | 5.0 - 10.0 |
| `speed` | **Pace**: Playback speed of the generated audio. | 1.0 (Normal) |

---

## 🔧 Hardware & Performance Note

### RTX 50-Series (Blackwell) Consistency
This build includes the **torchvision (cu128)** layer. This fix resolves the `nms operator` runtime error common in modern PyTorch builds on 50-series hardware, ensuring that **Vocal Isolation** and **MDX separations** run at full performance without fallback to CPU.

---

## 📄 License & Ethics
This project is for personal research. Always adhere to Coqui TTS licenses and ensure you have permission to use the voice samples you clone.

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
