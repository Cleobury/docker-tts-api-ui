import os
os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] = "0"
from flask import Flask, request, jsonify, Response, stream_with_context
from TTS.api import TTS
import torch
import struct

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
                temperature=0.65,
                repetition_penalty=5.0,
                speed=1.0,
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
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)