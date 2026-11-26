"""Offline dictation on an NVIDIA GPU when CUDA 12 is usable, otherwise the CPU. Audio and transcripts are never logged."""
import argparse
import ctypes
import glob
import json
import os
import sys
import time

GPU = {'device': 'cuda', 'compute_type': 'float16'}
CPU = {'device': 'cpu', 'compute_type': 'int8', 'cpu_threads': 4}

def cuda_ready():
    """True when CTranslate2 sees a GPU and can load the CUDA 12 cuBLAS it needs."""
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() < 1:
            return False
        if sys.platform == 'win32':
            # The optional nvidia-cublas-cu12 wheel installs its DLLs outside the default search path.
            site = os.path.dirname(os.path.dirname(ctranslate2.__file__))
            for folder in glob.glob(os.path.join(site, 'nvidia', '*', 'bin')):
                os.add_dll_directory(folder)
            ctypes.CDLL('cublas64_12.dll')
        else:
            ctypes.CDLL('libcublas.so.12')
        return True
    except Exception:
        return False

def transcribe(model_path, audio, factory=None, gpu=None):
    if factory is None:
        from faster_whisper import WhisperModel
        factory = WhisperModel
    attempts = ([GPU] if (cuda_ready() if gpu is None else gpu) else []) + [CPU]
    for options in attempts:
        try:
            started = time.perf_counter()
            model = factory(model_path, local_files_only=True, **options)
            loaded = time.perf_counter()
            segments, info = model.transcribe(audio, task='transcribe', vad_filter=True, beam_size=5, condition_on_previous_text=False)
            # Segments decode lazily, so a GPU runtime failure surfaces here and falls back to the CPU.
            text = ' '.join(segment.text.strip() for segment in segments).strip()
            return {'text': text, 'device': options['device'], 'language': getattr(info, 'language', None),
                    'seconds': {'load': round(loaded - started, 2), 'transcribe': round(time.perf_counter() - loaded, 2)}}
        except Exception:
            if options is attempts[-1]:
                raise

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--audio', required=True)
    args = parser.parse_args()
    from faster_whisper.audio import decode_audio
    audio = decode_audio(args.audio, sampling_rate=16000)
    if len(audio) > 125 * 16000:
        raise ValueError('Recording exceeds two minutes')
    print(json.dumps(transcribe(args.model, audio)))

if __name__ == '__main__':
    main()
