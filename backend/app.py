import os
import re
import base64
import io
import time
from functools import lru_cache
from datetime import datetime, timezone
from uuid import uuid4

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score
from flask import Flask, request, jsonify
from database import tasks_collection, sessions_collection
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
        if torch.cuda.is_available():
            print("CUDA is available. Loading the model onto GPU 0...")
            model = AutoModelForCausalLM.from_pretrained(
                MODEL_NAME,
                torch_dtype=torch.float16,
                low_cpu_mem_usage=True,
            )
            model = model.to("cuda:0")
        else:
            print("CUDA is unavailable. Loading the model onto CPU...")
            model = AutoModelForCausalLM.from_pretrained(
                MODEL_NAME,
                torch_dtype=torch.float32,
                low_cpu_mem_usage=True,
            )
            model = model.to("cpu")
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
    # REMOVE ORIGINAL PROMPT                                                 #1
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
# SUMMARIZE                                                                                     #2
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
    data = request.get_json(                                         #get data from the frontend 
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
# RANDOM FOREST — PERSONALIZED PRODUCTIVITY INSIGHTS
# ============================================================

def extract_session_features(session):
    """Convert one study session into numeric ML features."""
    minutes = float(session.get("minutes", 0) or 0)
    session_type = str(session.get("type", "study")).lower()
    timestamp = session.get("time") or session.get("date") or ""

    try:
        session_time = datetime.fromisoformat(
            str(timestamp).replace("Z", "+00:00")
        )
    except (ValueError, TypeError):
        session_time = datetime.now()

    return [
        minutes,
        session_time.hour,
        session_time.weekday(),
        int(session_type == "study"),
        float(session.get("distraction_count", 0) or 0),
        float(session.get("focus_score", 0) or 0),
    ]


@app.post("/api/analytics/ml-insights")
def random_forest_insights():
    """Train on sessions with explicit goal_met True/False feedback."""
    data = request.get_json(silent=True) or {}
    sessions = data.get("sessions", [])

    if not isinstance(sessions, list):
        return jsonify(error="Sessions must be a list."), 400

    labeled_sessions = [
        session for session in sessions
        if isinstance(session, dict)
        and isinstance(session.get("goal_met"), bool)
        and str(session.get("type", "study")).lower() == "study"
    ]

    total_labeled = len(labeled_sessions)
    if total_labeled < 10:
        return jsonify(
            status="insufficient_data",
            message=(
                "Complete at least 10 study sessions and record "
                "whether you achieved each session goal."
            ),
            labeled_sessions=total_labeled,
            required_sessions=10,
        )

    features = [extract_session_features(s) for s in labeled_sessions]
    labels = [int(s["goal_met"]) for s in labeled_sessions]
    successful = sum(labels)
    unsuccessful = len(labels) - successful

    if successful == 0 or unsuccessful == 0:
        return jsonify(
            status="insufficient_classes",
            message=(
                "The model needs feedback from both successful "
                "and unsuccessful sessions."
            ),
            labeled_sessions=total_labeled,
            successful_sessions=successful,
            unsuccessful_sessions=unsuccessful,
        )

    try:
        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=6,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=42,
        )
        model.fit(features, labels)

        # Cross-validation is reported only when both classes have
        # enough examples. It is an estimate, not a guarantee.
        smallest_class = min(successful, unsuccessful)
        validation_accuracy = None
        if smallest_class >= 2:
            folds = min(5, smallest_class)
            validation_model = RandomForestClassifier(
                n_estimators=100,
                max_depth=6,
                min_samples_leaf=2,
                class_weight="balanced",
                random_state=42,
            )
            scores = cross_val_score(
                validation_model,
                features,
                labels,
                cv=folds,
                scoring="accuracy",
            )
            validation_accuracy = round(float(scores.mean()) * 100, 1)

        now = datetime.now()
        probabilities = model.predict_proba([[
            25, now.hour, now.weekday(), 1, 0, 0
        ]])[0]
        class_probabilities = dict(zip(model.classes_, probabilities))
        goal_probability = round(
            float(class_probabilities.get(1, 0)) * 100, 1
        )

        feature_names = [
            "session_minutes", "hour_of_day", "day_of_week",
            "is_study_session", "distraction_count", "focus_score",
        ]
        feature_importance = sorted(
            [
                {"feature": name, "importance": round(float(value), 4)}
                for name, value in zip(
                    feature_names, model.feature_importances_
                )
            ],
            key=lambda item: item["importance"],
            reverse=True,
        )

        return jsonify(
            status="success",
            model="RandomForestClassifier",
            labeled_sessions=total_labeled,
            successful_sessions=successful,
            unsuccessful_sessions=unsuccessful,
            prediction={
                "session_minutes": 25,
                "predicted_goal_success_percent": goal_probability,
                "description": (
                    "Estimated probability based on labeled study-session history."
                ),
            },
            cross_validation_accuracy=validation_accuracy,
            feature_importance=feature_importance,
            note=(
                "Experimental estimate; predictions may be unreliable "
                "with a small personal dataset."
            ),
        )
    except Exception as e:
        app.logger.exception("Random Forest insights failed")
        return jsonify(error="Could not generate ML insights."), 500


# ============================================================
# RANDOM FOREST — SYNTHETIC 2-MINUTE DEMO
# ============================================================
@app.post("/api/analytics/ml-demo")
def random_forest_demo():
    """Run a clearly labeled demonstration on reproducible synthetic sessions."""
    try:
        import random
        rng = random.Random(42)
        demo_sessions = []
        # Build reproducible sample sessions with a plausible, deliberately
        # illustrative relationship between habits and goal success.
        for i in range(120):
            hour = [8, 9, 10, 14, 15, 17, 18, 19, 20, 21][i % 10]
            minutes = [10, 15, 20, 25, 30][(i * 3) % 5]
            distractions = rng.randint(0, 6)
            focus_score = max(25, min(100, 92 - distractions * 8 + rng.randint(-12, 10)))
            # Simulated outcome only; these are not observations from a user.
            score = 0.45 + (0.12 if 17 <= hour <= 20 else 0) \
                    + (0.12 if distractions <= 1 else 0) \
                    + (0.08 if minutes in (20, 25) else 0) \
                    + (focus_score - 60) / 250 + rng.uniform(-0.24, 0.24)
            demo_sessions.append({
                "minutes": minutes,
                "type": "study",
                "time": f"2026-01-{(i % 28) + 1:02d}T{hour:02d}:00:00",
                "distraction_count": distractions,
                "focus_score": focus_score,
                "goal_met": score >= 0.55,
            })

        X = [extract_session_features(s) for s in demo_sessions]
        y = [int(s["goal_met"]) for s in demo_sessions]
        model = RandomForestClassifier(
            n_estimators=100, max_depth=6, min_samples_leaf=2,
            class_weight="balanced", random_state=42,
        )
        model.fit(X, y)
        # CV score is a descriptive demo metric, not real-world validation.
        smallest_class = min(sum(y), len(y) - sum(y))
        cv_folds = min(5, smallest_class)
        accuracy = None
        if cv_folds >= 2:
            scores = cross_val_score(
                RandomForestClassifier(
                    n_estimators=100, max_depth=6, min_samples_leaf=2,
                    class_weight="balanced", random_state=42,
                ), X, y, cv=cv_folds, scoring="accuracy"
            )
            accuracy = round(float(scores.mean()) * 100, 1)

        probabilities = model.predict_proba([[2, 19, 0, 1, 0, 85]])[0]
        class_probabilities = dict(zip(model.classes_, probabilities))
        predicted = round(float(class_probabilities.get(1, 0)) * 100, 1)

        def success_rate(items):
            return round(100 * sum(int(s["goal_met"]) for s in items) / len(items), 1) if items else None

        evening = [s for s in demo_sessions if 17 <= datetime.fromisoformat(s["time"]).hour < 21]
        low_dist = [s for s in demo_sessions if s["distraction_count"] <= 1]
        high_dist = [s for s in demo_sessions if s["distraction_count"] >= 4]
        ten_min = [s for s in demo_sessions if 8 <= s["minutes"] <= 12]
        twenty_five = [s for s in demo_sessions if 23 <= s["minutes"] <= 27]
        feature_names = [
            "session_minutes", "hour_of_day", "day_of_week",
            "is_study_session", "distraction_count", "focus_score",
        ]
        importance = sorted([
            {"feature": name, "importance": round(float(value), 4)}
            for name, value in zip(feature_names, model.feature_importances_)
        ], key=lambda x: x["importance"], reverse=True)
        return jsonify(
            status="success",
            demo_mode=True,
            model="RandomForestClassifier",
            prediction={
                "session_minutes": 2,
                "predicted_goal_success_percent": predicted,
                "description": "Illustrative estimate from synthetic demonstration data.",
            },
            test_accuracy_percent=accuracy,
            sample_sessions=len(demo_sessions),
            productivity_insights={
                "best_study_time": {
                    "label": "5 PM – 9 PM",
                    "start_hour": 17,
                    "end_hour": 21,
                    "success_rate_percent": success_rate(evening),
                    "sessions": len(evening),
                } if evening else None,
                "low_distraction_success_percent": success_rate(low_dist),
                "low_distraction_sessions": len(low_dist),
                "high_distraction_success_percent": success_rate(high_dist),
                "high_distraction_sessions": len(high_dist),
                "ten_minute_success_percent": success_rate(ten_min),
                "ten_minute_sessions": len(ten_min),
                "twenty_five_minute_success_percent": success_rate(twenty_five),
                "twenty_five_minute_sessions": len(twenty_five),
            },
            feature_importance=importance,
            note="Synthetic demo only. Outcomes and accuracy are illustrative, not real student results.",
        ), 200
    except Exception:
        app.logger.exception("Random Forest demo failed")
        return jsonify(error="Could not generate demo ML insights."), 500


# ============================================================
# TASK APIs - MongoDB
# ============================================================

@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    try:
        tasks = list(
            tasks_collection.find({}, {"_id": 0}).sort("created_at", -1)
        )
        return jsonify(tasks=tasks), 200
    except Exception:
        app.logger.exception("Failed to fetch tasks")
        return jsonify(error="Failed to fetch tasks"), 500


@app.route("/api/tasks", methods=["POST"])
def create_task():
    try:
        data = request.get_json(silent=True) or {}

        text = data.get("text", "")
        priority = data.get("priority", "medium")

        if not isinstance(text, str) or not text.strip():
            return jsonify(error="Task text is required"), 400

        if priority not in ("low", "medium", "high"):
            return jsonify(error="Invalid priority"), 400

        task = {
            "id": str(uuid4()),
            "text": text.strip(),
            "priority": priority,
            "done": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        # Save task to MongoDB
        tasks_collection.insert_one(task)

        # Remove MongoDB ObjectId before sending JSON response
        task.pop("_id", None)

        return jsonify(task=task), 201

    except Exception:
        app.logger.exception("Failed to create task")
        return jsonify(error="Failed to create task"), 500


@app.route("/api/tasks/<task_id>", methods=["PATCH"])
def update_task(task_id):
    try:
        data = request.get_json(silent=True) or {}
        updates = {}

        if "done" in data:
            if not isinstance(data["done"], bool):
                return jsonify(error="done must be true or false"), 400
            updates["done"] = data["done"]

        if "text" in data:
            text = data["text"]
            if not isinstance(text, str) or not text.strip():
                return jsonify(error="Invalid task text"), 400
            updates["text"] = text.strip()

        if "priority" in data:
            if data["priority"] not in ("low", "medium", "high"):
                return jsonify(error="Invalid priority"), 400
            updates["priority"] = data["priority"]

        if not updates:
            return jsonify(error="No valid updates supplied"), 400

        result = tasks_collection.update_one({"id": task_id}, {"$set": updates})
        if result.matched_count == 0:
            return jsonify(error="Task not found"), 404

        task = tasks_collection.find_one({"id": task_id}, {"_id": 0})
        return jsonify(task=task), 200
    except Exception:
        app.logger.exception("Failed to update task")
        return jsonify(error="Failed to update task"), 500


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    try:
        result = tasks_collection.delete_one({"id": task_id})
        if result.deleted_count == 0:
            return jsonify(error="Task not found"), 404
        return jsonify(message="Task deleted"), 200
    except Exception:
        app.logger.exception("Failed to delete task")
        return jsonify(error="Failed to delete task"), 500


# ============================================================
# FOCUS SESSION APIs - MongoDB
# ============================================================

@app.route("/api/sessions", methods=["GET"])
def get_sessions():
    """Return saved focus sessions, newest first."""
    try:
        sessions = list(
            sessions_collection.find(
                {},
                {"_id": 0}
            ).sort("created_at", -1).limit(500)
        )
        return jsonify(sessions=sessions), 200
    except Exception:
        app.logger.exception("Failed to fetch sessions")
        return jsonify(error="Failed to fetch sessions"), 500


@app.route("/api/sessions", methods=["POST"])
def create_session():
    """Save one completed study session; repeated IDs won't create duplicates."""
    try:
        data = request.get_json(silent=True) or {}

        raw_id = data.get("id")
        if raw_id is None or isinstance(raw_id, bool):
            return jsonify(error="Session ID is required"), 400
        session_id = str(raw_id).strip()
        if not session_id:
            return jsonify(error="Session ID is required"), 400

        minutes = data.get("minutes")
        if (
            isinstance(minutes, bool)
            or not isinstance(minutes, (int, float))
            or not 0 < minutes <= 180
        ):
            return jsonify(error="Invalid session duration"), 400

        session_type = str(data.get("type", "study")).lower()
        if session_type != "study":
            return jsonify(error="Only completed study sessions can be saved"), 400

        # Preserve fields used by the existing analytics/Random Forest flow.
        goal_met = data.get("goal_met")
        if goal_met is not None and not isinstance(goal_met, bool):
            return jsonify(error="goal_met must be true, false, or null"), 400

        try:
            focus_score = float(data.get("focus_score", 0) or 0)
            distraction_count = int(data.get("distraction_count", 0) or 0)
        except (TypeError, ValueError):
            return jsonify(error="Invalid focus or distraction value"), 400

        if not 0 <= focus_score <= 100 or distraction_count < 0:
            return jsonify(error="Invalid focus or distraction value"), 400

        session = {
            "id": session_id,
            "date": data.get("date"),
            "minutes": float(minutes),
            "type": "study",
            "time": data.get("time"),
            "focus_score": focus_score,
            "distraction_count": distraction_count,
            "goal_met": goal_met,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        sessions_collection.update_one(
            {"id": session_id},
            {"$setOnInsert": session},
            upsert=True
        )

        return jsonify(message="Session saved", id=session_id), 201

    except Exception:
        app.logger.exception("Failed to save session")
        return jsonify(error="Failed to save session"), 500


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
    debug=True,
    use_reloader=False
)
