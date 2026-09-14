# FocusAI — AI-Powered Productivity & Focus Management System

A local-first student productivity application built with React + Vite on the frontend and Flask/Python on the backend.

## Features

- Dashboard with study goal, focus score, tasks and session stats
- Smart Notes: image OCR, PDF/text import, editing, local AI summarization and question generation
- Task manager with localStorage persistence
- Daily study goals
- Configurable study/break timer
- Analytics with weekly/monthly charts
- Productivity mode with browser distraction tracking
- Focus Monitoring using browser WebRTC + Flask/OpenCV face-presence checks
- Relax Mode with local rain/nature/water sounds during breaks
- Professional responsive UI
- No paid API keys required

## Requirements

- Windows 10/11
- Python 3.11+ (3.12 recommended)
- Node.js 18+ (20/22 LTS recommended)
- Tesseract OCR installed on Windows for OCR:
  https://github.com/UB-Mannheim/tesseract/wiki

## Run

### Backend
```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Backend: http://127.0.0.1:5000

The AI model downloads from Hugging Face the first time you use Summarize/Generate Questions. Default model:
`google/flan-t5-base`

For a lighter model, set:
```powershell
$env:AI_MODEL="google/flan-t5-small"
```

### Frontend
Open a second terminal:
```powershell
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173

## Tesseract

Install Tesseract on Windows. If it is not detected automatically, set:
```powershell
$env:TESSERACT_CMD="C:\Program Files\Tesseract-OCR\tesseract.exe"
```

## Notes about browser limitations

A normal browser cannot reliably monitor arbitrary Windows applications. Productivity Mode therefore tracks browser tab visibility, leaving the app, and configurable website/domain events. The focus camera feature sends periodic webcam snapshots to Flask for face-presence checking; it does not permanently store video.

## Project structure

```text
focus-ai-productivity-system/
├── frontend/
├── backend/
├── assets/
│   └── audio/
└── README.md
```
