
import time
import os
from functools import lru_cache



MODEL_NAME = os.getenv(
    "AI_MODEL",
    "Qwen/Qwen2.5-1.5B-Instruct"
)

@lru_cache(maxsize=1)
def get_ai():
    print("=" * 50)
    print("Loading FocusAI model:", MODEL_NAME)

    start_time = time.time()

    try:
        import torch
        from transformers import (
            AutoTokenizer,
            AutoModelForCausalLM,
        )

        if torch.cuda.is_available():
            device = torch.device("cuda")
            dtype = torch.float16
            print("Using CUDA GPU")
        else:
            device = torch.device("cpu")
            dtype = torch.float32
            print("Using CPU")

        tokenizer = AutoTokenizer.from_pretrained(
            MODEL_NAME
        )

        model = AutoModelForCausalLM.from_pretrained(
            MODEL_NAME,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
        )

        model = model.to(device)
        model.eval()

        print(
            f"Model loaded in {time.time() - start_time:.1f}s"
        )

        return tokenizer, model

    except Exception as e:
        print("MODEL LOADING FAILED:", repr(e))
        raise
