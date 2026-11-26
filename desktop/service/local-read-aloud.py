import base64, contextlib, io, json, sys, wave
from pathlib import Path
import numpy as np
import onnxruntime as rt
from kokoro_onnx import Kokoro
root = Path(sys.argv[1])
with contextlib.redirect_stdout(sys.stderr):
    options = rt.SessionOptions(); options.intra_op_num_threads = 4
    session = rt.InferenceSession(str(root / 'kokoro-v1.0.int8.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    engine = Kokoro.from_session(session, str(root / 'voices-v1.0.bin'))
voice_languages = {
    'am_michael': 'en-us',
    'bf_emma': 'en-gb',
    'pf_dora': 'pt-br',
    'pm_alex': 'pt-br',
    'pm_santa': 'pt-br',
}

for line in sys.stdin:
    try:
        request = json.loads(line)
        voice = request['voice']
        text = request['text']
        if voice not in voice_languages or not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise ValueError()
        with contextlib.redirect_stdout(sys.stderr):
            samples, rate = engine.create(text, voice=voice, lang=voice_languages[voice])
        audio = io.BytesIO()
        with wave.open(audio, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate)
            wav.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
        print(json.dumps({'audio': base64.b64encode(audio.getvalue()).decode()}), flush=True)
    except Exception:
        print(json.dumps({'error': 'Local speech generation failed.'}), flush=True)
