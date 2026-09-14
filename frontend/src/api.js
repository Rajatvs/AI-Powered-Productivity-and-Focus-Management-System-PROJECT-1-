const API =
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:5000";

/*
 * ============================================================
 * HELPER
 * ============================================================
 *
 * Gives every API request a timeout.
 * This prevents the UI from staying on "Processing..."
 * forever if Flask or the AI model gets stuck.
 */

async function fetchWithTimeout(
  url,
  options = {},
  timeout = 120000
) {
  const controller =
    new AbortController();

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    timeout
  );

  try {
    const response = await fetch(
      url,
      {
        ...options,
        signal:
          controller.signal,
      }
    );

    return response;
  } catch (error) {
    if (
      error.name ===
      "AbortError"
    ) {
      throw new Error(
        "The AI request took too long. The local AI model may still be loading. Check the Flask terminal for details."
      );
    }

    if (
      error instanceof TypeError
    ) {
      throw new Error(
        "Cannot connect to the FocusAI backend. Make sure Flask is running on port 5000."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}


/*
 * ============================================================
 * SAFELY READ JSON
 * ============================================================
 */

async function readJson(response) {
  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  if (
    contentType.includes(
      "application/json"
    )
  ) {
    return await response.json();
  }

  const text =
    await response.text();

  return {
    error:
      text ||
      "The backend returned an invalid response."
  };
}


/*
 * ============================================================
 * SUMMARIZE TEXT
 * ============================================================
 */

export async function summarizeText(
  text
) {
  if (!text || !text.trim()) {
    throw new Error(
      "There is no text to summarize."
    );
  }

  const r =
    await fetchWithTimeout(
      `${API}/api/summarize`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          text: text.trim(),
        }),
      },
      120000
    );

  const data =
    await readJson(r);

  if (!r.ok) {
    throw new Error(
      data.error ||
        `Summarization failed (${r.status}).`
    );
  }

  if (
    !data.summary ||
    !String(data.summary).trim()
  ) {
    throw new Error(
      "The AI returned an empty summary."
    );
  }

  return data.summary;
}


/*
 * ============================================================
 * GENERATE QUESTIONS
 * ============================================================
 */

export async function generateQuestions(
  text
) {
  if (!text || !text.trim()) {
    throw new Error(
      "There is no text to generate questions from."
    );
  }

  const r =
    await fetchWithTimeout(
      `${API}/api/generate-questions`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          text: text.trim(),
        }),
      },
      120000
    );

  const data =
    await readJson(r);

  if (!r.ok) {
    throw new Error(
      data.error ||
        `Question generation failed (${r.status}).`
    );
  }

  if (
    !data.questions ||
    !String(data.questions).trim()
  ) {
    throw new Error(
      "The AI returned no questions."
    );
  }

  return data.questions;
}


/*
 * ============================================================
 * FILE EXTRACTION / OCR
 * ============================================================
 */

export async function extractFile(
  file
) {
  if (!file) {
    throw new Error(
      "No file selected."
    );
  }

  const fd =
    new FormData();

  fd.append(
    "file",
    file
  );

  const r =
    await fetchWithTimeout(
      `${API}/api/ocr`,
      {
        method: "POST",
        body: fd,
      },
      60000
    );

  const data =
    await readJson(r);

  if (!r.ok) {
    throw new Error(
      data.error ||
        `File extraction failed (${r.status}).`
    );
  }

  if (
    !data.text ||
    !String(data.text).trim()
  ) {
    throw new Error(
      "No text was extracted from the file."
    );
  }

  return data.text;
}


/*
 * ============================================================
 * FACE CHECK
 * ============================================================
 */

export async function checkFace(
  dataUrl
) {
  if (!dataUrl) {
    throw new Error(
      "No camera image supplied."
    );
  }

  const r =
    await fetchWithTimeout(
      `${API}/api/face-check`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          image: dataUrl,
        }),
      },
      30000
    );

  const data =
    await readJson(r);

  if (!r.ok) {
    throw new Error(
      data.error ||
        `Face check failed (${r.status}).`
    );
  }

  return data;
}


/*
 * ============================================================
 * HEALTH CHECK
 * ============================================================
 */

export async function checkBackend() {
  const r =
    await fetchWithTimeout(
      `${API}/api/health`,
      {
        method: "GET",
      },
      10000
    );

  const data =
    await readJson(r);

  if (!r.ok) {
    throw new Error(
      data.error ||
        "Backend health check failed."
    );
  }

  return data;
}