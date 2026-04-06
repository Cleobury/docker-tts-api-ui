import os
os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] = "0"
from flask import Flask, request, jsonify, Response, stream_with_context
from TTS.api import TTS
import torch
import struct
import sys
import traceback

# --- NEURAL COMPATIBILITY PATCH ---
# Modern torchaudio (2.1+) removed 'torchaudio.backend'. 
# DeepFilterNet still looks for it. We mock it here to ensure Blackwell compatibility.
import torchaudio
from types import ModuleType
try:
    import torchaudio.backend
except ImportError:
    # Create the top-level torchaudio.backend
    mock_backend = ModuleType("torchaudio.backend")
    sys.modules["torchaudio.backend"] = mock_backend
    
    # Create torchaudio.backend.common
    mock_common = ModuleType("torchaudio.backend.common")
    sys.modules["torchaudio.backend.common"] = mock_common
    
    # Point the mock common to the main torchaudio module or metadata
    # DeepFilterNet specifically needs torchaudio.backend.common.AudioMetaData
    # In versions 2.x, AudioMetaData is move to the top level.
    mock_common.AudioMetaData = getattr(torchaudio, "AudioMetaData", None)

# --- THE NEURAL-BRIDGE (Legacy Metadata Support) ---
# Modern torchaudio (2.11+) removed .info(). We bridge it using soundfile.
import soundfile as sf
class MockAudioMetaData:
    def __init__(self, sr, frames, channels):
        self.sample_rate = sr
        self.num_frames = frames
        self.num_channels = channels

def mock_info(filepath, **kwargs):
    try:
        data = sf.info(filepath)
        return MockAudioMetaData(data.samplerate, data.frames, data.channels)
    except Exception as e:
        print(f"Neural-Bridge Metadata Error: {e}")
        # Return a safe default for 5090 processing
        return MockAudioMetaData(48000, 0, 1)

# Inject the bridge into the torchaudio namespace
torchaudio.info = mock_info
if not hasattr(torchaudio, "AudioMetaData"):
    torchaudio.AudioMetaData = MockAudioMetaData
if not hasattr(sys.modules["torchaudio.backend.common"], "AudioMetaData"):
    sys.modules["torchaudio.backend.common"].AudioMetaData = MockAudioMetaData

app = Flask(__name__)

print("Loading XTTSv2 into VRAM on RTX 5090...")
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")
print("Model loaded and ready.")

def get_wav_header(sample_rate=24000):
    """ Returns a 44-byte WAV header for streaming. """
    # Placeholder for 'infinity' length (approx 2GB)
    data_size = 0x7fffffff 
    file_size = data_size + 36
    header = struct.pack('<4sI4s4sIHHIIHH4sI',
        b'RIFF', file_size, b'WAVE', b'fmt ', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16, b'data', data_size)
    return header

@app.route('/generate', methods=['POST'])
def generate():
    try:
        data = request.json
        speaker_wav = data['speaker_wav']
        language = data['language']
        text = data['text']
        
        # Access the underlying model
        model = tts.synthesizer.tts_model
        
        # Logic to get latents with Tensor-safe checks
        gpt_cond_latent = None
        speaker_embedding = None
        # --- INFERENCE PARAMETERS ---
        temperature = float(request.args.get('temperature', 0.65))
        repetition_penalty = float(request.args.get('repetition_penalty', 5.0))
        speed = float(request.args.get('speed', 1.0))

        if isinstance(speaker_wav, str) and speaker_wav.endswith(".pth"):
            latents = torch.load(speaker_wav, map_location=model.device)
            if isinstance(latents, dict):
                # Search for keys without using 'or' on Tensors
                for k in ["gpt_cond_latent", "latent", "gpt_latent", "xtts_latent"]:
                    if k in latents:
                        gpt_cond_latent = latents[k]
                        break
                for k in ["speaker_embedding", "embedding", "xtts_embedding", "spk_emb"]:
                    if k in latents:
                        speaker_embedding = latents[k]
                        break
            elif isinstance(latents, (list, tuple)):
                gpt_cond_latent = latents[0]
                speaker_embedding = latents[1]
        else:
            # For raw audio clips, compute latents once per request
            gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(audio_path=speaker_wav)

        def generate_audio_stream():
            # 1. Yield WAV Header immediately
            yield get_wav_header()
            
            # 2. Get the inference stream from XTTS
            chunks = model.inference_stream(
                text=text,
                language=language,
                gpt_cond_latent=gpt_cond_latent,
                speaker_embedding=speaker_embedding,
                temperature=temperature,
                repetition_penalty=repetition_penalty,
                speed=speed,
                enable_text_splitting=True,
                stream_chunk_size=20 # Small chunk size for low latency 
            )

            for chunk in chunks:
                # Convert chunk (Tensor) to 16-bit PCM bytes
                # Ensure it's on CPU and converted to int16
                chunk_data = (chunk * 32767).to(torch.int16).cpu().numpy().tobytes()
                yield chunk_data

        return Response(stream_with_context(generate_audio_stream()), mimetype="audio/wav")

    except Exception as e:
        print(f"Streaming Error: {e}")
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/bake', methods=['POST'])
def bake():
    try:
        data = request.json
        speaker = data['speaker']
        speaker_wavs = data['speaker_wav'] # This will be an array of paths
        
        print(f"Baking Model for {speaker} from {len(speaker_wavs)} clips...")
        
        # Access the underlying model through the synthesizer
        model = tts.synthesizer.tts_model
        
        # Extract latents using the XTTS model
        gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(audio_path=speaker_wavs)
        
        # Save to the voices folder
        out_path = f"/shared/voices/{speaker}.pth"
        torch.save({
            "gpt_cond_latent": gpt_cond_latent,
            "speaker_embedding": speaker_embedding
        }, out_path)
        
        print(f"Success! Model saved to {out_path}")
        return jsonify({"success": True, "path": out_path})
    except Exception as e:
        print(f"Bake Error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

# --- BLACKWELL NEURAL ENHANCER CORE ---
@app.route('/enhance', methods=['POST'])
def enhance_audio():
    try:
        data = request.json
        input_path = data['input_path']
        output_path = data['output_path']
        mode = data.get('mode', 'vocal_isolation') # 'vocal_isolation' or 'denoise'
        
        print(f"Enhancement Task: {mode} for {input_path}")
        
        if mode == 'vocal_isolation':
            from audio_separator.separator import Separator
            # Initialize separator with Blackwell-optimized settings
            separator = Separator(
                output_dir=os.path.dirname(output_path),
                model_file_dir="/shared/models/enhancer",
                output_format="WAV",
                # Use the Voc_FT model which is excellent for high-fidelity vocal extraction
                mdx_params={"hop_length": 1024, "segment_size": 256, "overlap": 0.25, "batch_size": 1}
            )
            separator.load_model('UVR-MDX-NET-Voc_FT.onnx')
            output_files = separator.separate(input_path)
            
            # audio-separator returns a list of files; we want the vocal one
            # Usually named something like "input_Vocals.wav"
            vocal_file = next((f for f in output_files if 'Vocals' in f), None)
            instr_file = next((f for f in output_files if 'Instrumental' in f), None)
            
            if vocal_file:
                vocal_path = os.path.join(os.path.dirname(input_path), vocal_file)
                os.rename(vocal_path, output_path)
            
            # Archive the instrumental if found
            if instr_file:
                instr_dir = os.path.join(os.path.dirname(input_path), "instrumental")
                os.makedirs(instr_dir, exist_ok=True)
                instr_src = os.path.join(os.path.dirname(input_path), instr_file)
                instr_dest = os.path.join(instr_dir, instr_file)
                os.rename(instr_src, instr_dest)
                print(f"Archived Instrumental to: {instr_dest}")
            
        elif mode == 'denoise':
            from df.enhance import enhance, init_df, load_audio, save_audio
            # Initialize DeepFilterNet3 (best-in-class noise reduction)
            model, df_state, _ = init_df()
            # Use the modern API to get the sample rate from df_state
            sr = df_state.sr()
            audio, _ = load_audio(input_path, sr=sr)
            # Perform neural enhancement
            enhanced = enhance(model, df_state, audio)
            save_audio(output_path, enhanced, sr)
            
        else:
            raise ValueError(f"Unknown enhancement mode: {mode}")

        return jsonify({"success": True, "output_path": output_path})
    except Exception as e:
        print(f"Enhancement Error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)