import os
import re
import base64
import io
import time

from functools import lru_cache

from flask import Flask, request, jsonify
from flask_cors import CORS

import cv2
import numpy as np

from PIL import Image
import pytesseract
from pypdf import PdfReader


# ============================================================
# FLASK
# ============================================================

app = Flask(__name__)

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": "*"
        }
    }
)


# ============================================================
# AI MODEL SETTINGS
# ============================================================

MODEL_NAME = os.getenv(
    "AI_MODEL",
    "Qwen/Qwen2.5-1.5B-Instruct"
)

TESSERACT_CMD = os.getenv(
    "TESSERACT_CMD"
)

if TESSERACT_CMD:
    pytesseract.pytesseract.tesseract_cmd = (
        TESSERACT_CMD
    )


# ============================================================
# TEXT CLEANING
# ============================================================

def clean_text(text):

    if not text:
        return ""

    text = text.replace(
        "\x00",
        " "
    )

    text = re.sub(
        r"[ \t]+",
        " ",
        text
    )

    text = re.sub(
        r"\n{3,}",
        "\n\n",
        text
    )

    return text.strip()


# ============================================================
# LOAD QWEN MODEL
# ============================================================

@lru_cache(maxsize=1)
def get_ai():

    print()
    print("=" * 60)
    print("FOCUSAI AI MODEL")
    print("=" * 60)

    print(
        f"Loading model: {MODEL_NAME}"
    )

    print(
        "If this is the first run, "
        "Hugging Face may need to download the model."
    )

    print(
        "This can take several minutes."
    )

    print("=" * 60)

    start_time = time.time()

    try:

        import torch

        from transformers import (
            AutoTokenizer,
            AutoModelForCausalLM,
        )

        print(
            "Loading tokenizer..."
        )

        tokenizer = (
            AutoTokenizer.from_pretrained(
                MODEL_NAME
            )
        )

        print(
            "Tokenizer loaded."
        )

        print(
            "Loading language model..."
        )

        model = (
            AutoModelForCausalLM.from_pretrained(
                MODEL_NAME,

                torch_dtype="auto",

                device_map="auto",

                low_cpu_mem_usage=True
            )
        )

        model.eval()

        elapsed = (
            time.time()
            - start_time
        )

        print()
        print(
            f"MODEL LOADED SUCCESSFULLY "
            f"in {elapsed:.1f} seconds"
        )

        print(
            f"Model: {MODEL_NAME}"
        )

        print(
            f"Device: {model.device}"
        )

        print("=" * 60)
        print()

        return (
            tokenizer,
            model
        )

    except Exception as e:

        print()
        print("=" * 60)
        print("MODEL LOADING FAILED")
        print("=" * 60)

        print(
            repr(e)
        )

        print("=" * 60)
        print()

        raise


# ============================================================
# GENERATE TEXT USING QWEN
# ============================================================

def generate(
    prompt,
    max_new_tokens=160
):

    import torch

    tokenizer, model = get_ai()

    messages = [
        {
            "role": "system",
            "content": (
                "You are FocusAI, a helpful "
                "study assistant. "
                "Give clear, accurate and "
                "easy-to-understand answers. "
                "Use only information "
                "supported by the provided notes. "
                "Do not invent facts."
            )
        },

        {
            "role": "user",
            "content": prompt
        }
    ]

    # --------------------------------------------------------
    # CREATE QWEN CHAT PROMPT
    # --------------------------------------------------------

    text = (
        tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True
        )
    )

    # --------------------------------------------------------
    # TOKENIZE
    # --------------------------------------------------------

    inputs = tokenizer(
        [text],
        return_tensors="pt",
        truncation=True,
        max_length=4096
    )

    # --------------------------------------------------------
    # MOVE INPUTS TO MODEL DEVICE
    # --------------------------------------------------------

    try:

        device = model.device

        inputs = {
            key: value.to(device)
            for key, value in inputs.items()
        }

    except Exception:

        # Fallback for unusual
        # accelerate/device-map setups.

        pass

    # --------------------------------------------------------
    # GENERATE
    # --------------------------------------------------------

    print(
        "Generating AI response..."
    )

    start_time = time.time()

    with torch.inference_mode():

        outputs = model.generate(

            **inputs,

            max_new_tokens=max_new_tokens,

            do_sample=False,

            repetition_penalty=1.08,

            pad_token_id=(
                tokenizer.eos_token_id
            )
        )

    elapsed = (
        time.time()
        - start_time
    )

    print(
        f"Generation completed in "
        f"{elapsed:.1f} seconds"
    )

    # --------------------------------------------------------
    # REMOVE ORIGINAL PROMPT
    # --------------------------------------------------------

    generated_ids = []

    for (
        input_ids,
        output_ids
    ) in zip(
        inputs["input_ids"],
        outputs
    ):

        generated_ids.append(
            output_ids[
                len(input_ids):
            ]
        )

    # --------------------------------------------------------
    # DECODE
    # --------------------------------------------------------

    response = (
        tokenizer.batch_decode(
            generated_ids,
            skip_special_tokens=True
        )[0]
    )

    response = response.strip()

    if not response:

        raise RuntimeError(
            "The AI model returned an empty response."
        )

    return response


# ============================================================
# SPLIT LONG TEXT
# ============================================================

def chunks(
    text,
    size=1800
):

    words = text.split()

    for i in range(
        0,
        len(words),
        size
    ):

        yield " ".join(
            words[
                i:i + size
            ]
        )


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/api/health")
def health():

    loaded = (
        get_ai.cache_info().currsize
        > 0
    )

    return jsonify({

        "ok": True,

        "model": MODEL_NAME,

        "model_loaded": loaded

    })


# ============================================================
# OCR / FILE EXTRACTION
# ============================================================

@app.post("/api/ocr")
def ocr():

    if (
        "file"
        not in request.files
    ):

        return jsonify(
            error="No file uploaded."
        ), 400

    f = request.files[
        "file"
    ]

    name = (
        f.filename or ""
    ).lower()

    raw = f.read()

    try:

        # ----------------------------------------------------
        # PDF
        # ----------------------------------------------------

        if name.endswith(
            ".pdf"
        ):

            print(
                f"Extracting PDF: {f.filename}"
            )

            reader = PdfReader(
                io.BytesIO(raw)
            )

            text = "\n".join(

                (
                    page.extract_text()
                    or ""
                )

                for page in reader.pages

            )

            if not text.strip():

                return jsonify(
                    error=(
                        "This PDF has no "
                        "extractable text. "
                        "For scanned PDFs, "
                        "upload an image instead."
                    )
                ), 400

        # ----------------------------------------------------
        # TXT
        # ----------------------------------------------------

        elif name.endswith(
            ".txt"
        ):

            text = raw.decode(
                "utf-8",
                errors="ignore"
            )

        # ----------------------------------------------------
        # IMAGE
        # ----------------------------------------------------

        else:

            img = Image.open(
                io.BytesIO(raw)
            ).convert("RGB")

            text = (
                pytesseract.image_to_string(
                    img
                )
            )

        text = clean_text(
            text
        )

        if not text:

            return jsonify(
                error=(
                    "No text could be extracted. "
                    "Check the file quality."
                )
            ), 400

        print(
            f"Extracted {len(text)} characters."
        )

        return jsonify(
            text=text
        )

    except Exception as e:

        print(
            "OCR ERROR:",
            repr(e)
        )

        return jsonify(
            error=f"File extraction error: {e}"
        ), 500


# ============================================================
# SUMMARIZE
# ============================================================

@app.post("/api/summarize")
def summarize():

    print()
    print(
        "=========================================="
    )

    print(
        "SUMMARIZATION REQUEST"
    )

    print(
        "=========================================="
    )

    data = request.get_json(
        silent=True
    ) or {}

    text = clean_text(
        data.get(
            "text",
            ""
        )
    )

    if not text:

        return jsonify(
            error="Text is empty."
        ), 400

    print(
        f"Received {len(text)} characters."
    )

    # --------------------------------------------------------
    # Protect local model from extremely large input
    # --------------------------------------------------------

    max_chars = 12000

    if len(text) > max_chars:

        print(
            f"Input is large. "
            f"Truncating to {max_chars} characters."
        )

        text = text[
            :max_chars
        ]

    try:

        parts = list(
            chunks(
                text,
                size=1800
            )
        )

        print(
            f"Created {len(parts)} text chunk(s)."
        )

        summaries = []

        # ----------------------------------------------------
        # Summarize chunks
        # ----------------------------------------------------

        for index, part in enumerate(
            parts[:8],
            start=1
        ):

            print(
                f"Summarizing chunk "
                f"{index}/{min(len(parts), 8)}..."
            )

            prompt = f"""
Summarize the following study notes.

Create a clear study-friendly summary.

Keep:
- important concepts
- definitions
- important facts
- formulas
- key relationships

Do not invent information.

STUDY NOTES:

{part}
"""

            result = generate(
                prompt,
                max_new_tokens=140
            )

            summaries.append(
                result
            )

        # ----------------------------------------------------
        # Single chunk
        # ----------------------------------------------------

        if len(summaries) == 1:

            final_result = (
                summaries[0]
            )

        # ----------------------------------------------------
        # Multiple chunks
        # ----------------------------------------------------

        else:

            combined = (
                "\n\n".join(
                    summaries
                )
            )

            print(
                "Combining chunk summaries..."
            )

            final_result = generate(

                f"""
Combine the following study-note summaries
into one accurate, well-organized study summary.

Do not add information that is not present.

SUMMARIES:

{combined}
""",

                max_new_tokens=180
            )

        print(
            "SUMMARIZATION COMPLETE"
        )

        print(
            "=========================================="
        )

        return jsonify(
            summary=final_result
        )

    except Exception as e:

        print()
        print(
            "SUMMARIZATION ERROR:"
        )

        print(
            repr(e)
        )

        print(
            "=========================================="
        )

        return jsonify(
            error=(
                "AI summarization failed: "
                f"{e}"
            )
        ), 500


# ============================================================
# GENERATE QUESTIONS
# ============================================================

@app.post(
    "/api/generate-questions"
)
def questions():

    print()
    print(
        "=========================================="
    )

    print(
        "QUESTION GENERATION REQUEST"
    )

    print(
        "=========================================="
    )

    data = request.get_json(
        silent=True
    ) or {}

    text = clean_text(
        data.get(
            "text",
            ""
        )
    )

    if not text:

        return jsonify(
            error="Text is empty."
        ), 400

    print(
        f"Received {len(text)} characters."
    )

    max_chars = 12000

    if len(text) > max_chars:

        text = text[
            :max_chars
        ]

        print(
            f"Input truncated to "
            f"{max_chars} characters."
        )

    try:

        parts = list(
            chunks(
                text,
                size=1800
            )
        )

        questions_list = []

        for index, part in enumerate(
            parts[:6],
            start=1
        ):

            print(
                f"Generating questions "
                f"for chunk "
                f"{index}/{min(len(parts), 6)}..."
            )

            prompt = f"""
Generate important exam-style study questions
from the following notes.

Rules:
- Use numbered questions.
- Focus on important concepts.
- Include definitions and important facts.
- Do not invent facts.
- Use only information contained in the notes.

NOTES:

{part}
"""

            result = generate(
                prompt,
                max_new_tokens=160
            )

            questions_list.append(
                result
            )

        result = (
            "\n\n".join(
                questions_list
            )
        )

        print(
            "QUESTION GENERATION COMPLETE"
        )

        print(
            "=========================================="
        )

        return jsonify(
            questions=result
        )

    except Exception as e:

        print()
        print(
            "QUESTION GENERATION ERROR:"
        )

        print(
            repr(e)
        )

        print(
            "=========================================="
        )

        return jsonify(
            error=(
                "AI question generation failed: "
                f"{e}"
            )
        ), 500



# ============================================================
# FACE CHECK                                                           #FOCUS MONITOR
# ============================================================

@app.post("/api/face-check")
def face_check():

    data = request.get_json(
        silent=True
    ) or {}

    image = data.get(
        "image",
        ""
    )

    if not image:
        return jsonify(
            error="No image supplied."
        ), 400

    # --------------------------------------------------------
    # Remove data URL prefix
    # Example:
    # data:image/jpeg;base64,/9j/4AAQ...
    # --------------------------------------------------------

    if "," in image:
        image = image.split(
            ",",
            1
        )[1]

    try:

        # ----------------------------------------------------
        # Decode base64 image
        # ----------------------------------------------------

        arr = np.frombuffer(
            base64.b64decode(image),
            np.uint8
        )

        frame = cv2.imdecode(
            arr,
            cv2.IMREAD_COLOR
        )

        if frame is None:
            return jsonify(
                error="Invalid image data."
            ), 400

        # ----------------------------------------------------
        # Convert image to grayscale
        # ----------------------------------------------------

        gray = cv2.cvtColor(
            frame,
            cv2.COLOR_BGR2GRAY
        )

        # ----------------------------------------------------
        # Load OpenCV face detector
        # ----------------------------------------------------

        cascade_path = (
            cv2.data.haarcascades
            + "haarcascade_frontalface_default.xml"
        )

        detector = cv2.CascadeClassifier(
            cascade_path
        )

        # ----------------------------------------------------
        # Detect faces
        # ----------------------------------------------------

        faces = detector.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(60, 60)
        )

        face_detected = (
            len(faces) > 0
        )

        # ----------------------------------------------------
        # Return face status to React
        # ----------------------------------------------------

        return jsonify(
            face_detected=face_detected,
            count=len(faces)
        )

    except Exception as e:

        print(
            "FACE CHECK ERROR:",
            repr(e)
        )

        return jsonify(
            error=f"Face check failed: {e}"
        ), 400


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":

    print()
    print(
        "=========================================="
    )

    print(
        "          FOCUSAI BACKEND"
    )

    print(
        "=========================================="
    )

    print(
        f"AI model: {MODEL_NAME}"
    )

    print(
        "Backend:"
        " http://127.0.0.1:5000"
    )

    print(
        "Health:"
        " http://127.0.0.1:5000/api/health"
    )

    print(
        "=========================================="
    )

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )