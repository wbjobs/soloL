# 🎵 MIDI Music Analyzer

AI-powered MIDI file analysis web application with music style classification, emotion detection, and instrument analysis.

## Architecture

```
┌─────────────────┐     HTTP      ┌─────────────────┐    IPC     ┌──────────────────┐
│   React Frontend│ ◀──────────▶ │  Node.js Backend│ ◀────────▶ │  Python Backend  │
│  (MUI + Tone.js)│               │  (Express API)  │            │  (ONNX Runtime)  │
└─────────────────┘               └────────┬────────┘            └────────┬─────────┘
                                            │                              │
                                            ▼                              ▼
                                  ┌─────────────────┐            ┌──────────────────┐
                                  │  PostgreSQL DB  │            │  ONNX ML Models  │
                                  │  (Analysis      │            │  - Genre         │
                                  │   History)      │            │  - Emotion       │
                                  │                 │            │  - Instrument    │
                                  └─────────────────┘            └──────────────────┘
```

## Features

- 📁 **Batch Upload**: Upload up to 10 MIDI files simultaneously
- 🎵 **Style Classification**: Pop, Jazz, Classical, Rock, Electronic, HipHop, R&B, Country
- 😊 **Emotion Detection**: Happy, Sad, Energetic, Calm, Angry, Romantic, Mysterious, Epic
- 🎹 **Instrument Analysis**: Automatic instrument detection and categorization
- 🎼 **Chord Progression**: Major, Minor, 7th, Diminished, Augmented chords
- 📊 **Waveform Visualizer**: Interactive playback with section highlighting
- ⏱️ **Song Structure**: Intro, Verse, Chorus, Bridge, Outro detection
- 📄 **JSON Export**: Download detailed analysis reports
- 🎨 **Dark/Light Mode**: Beautiful UI with Material Design

## Tech Stack

### Frontend
- React 18 + React Router
- Material UI (MUI)
- Tone.js (MIDI playback)
- Recharts (visualizations)
- Axios (HTTP client)

### Backend
- Node.js + Express
- Multer (file uploads)
- python-shell (IPC)
- PostgreSQL (database)

### Python Backend
- mido (MIDI parsing)
- numpy (numerical processing)
- ONNX Runtime (ML inference)
- music21 (music theory)

## Prerequisites

- Node.js >= 18
- Python >= 3.9
- PostgreSQL >= 14
- pip and npm

## Quick Start

### 1. Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt

# Install React dependencies
cd client && npm install && cd ..
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your PostgreSQL credentials:
```
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=midi_analyzer
PYTHON_PATH=python
```

### 3. Initialize Database

```bash
# Create the database first (in PostgreSQL shell)
CREATE DATABASE midi_analyzer;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

# Then run the init script
npm run init-db
```

### 4. Start Development Servers

```bash
# Run both frontend and backend concurrently
npm run dev

# Or run separately:
npm run server    # Backend on http://localhost:3001
npm run client    # Frontend on http://localhost:3000
```

## API Endpoints

### Analysis
- `POST /api/analyses/upload` - Upload MIDI files (max 10)
- `GET /api/analyses` - List analysis history
- `GET /api/analyses/:id` - Get analysis details
- `GET /api/analyses/:id/waveform` - Get waveform data
- `GET /api/analyses/:id/export` - Export as JSON
- `POST /api/analyses/export/batch` - Batch export
- `DELETE /api/analyses/:id` - Delete analysis

### Batch Jobs
- `GET /api/analyses/batch/:batchId` - Get batch processing status

### Health
- `GET /api/health` - Health check

## Project Structure

```
├── client/                    # React frontend
│   ├── src/
│   │   ├── components/        # React components
│   │   │   ├── MidiUpload.jsx
│   │   │   ├── WaveformVisualizer.jsx
│   │   │   ├── AnalysisResults.jsx
│   │   │   └── AnalysisHistory.jsx
│   │   ├── services/
│   │   │   └── api.js         # API client
│   │   ├── App.jsx
│   │   └── index.js
│   └── package.json
│
├── server/                    # Node.js backend
│   ├── config/
│   │   ├── database.js        # PostgreSQL config
│   │   └── multer.js          # File upload config
│   ├── routes/
│   │   └── analyses.js        # API routes
│   ├── services/
│   │   ├── pythonBridge.js    # Node-Python IPC
│   │   └── analysisService.js # Business logic
│   ├── scripts/
│   │   └── init-db.js         # Database init
│   └── index.js               # Server entry
│
├── python/                    # Python backend
│   ├── models/                # ONNX model files
│   ├── midi_parser.py         # MIDI parsing
│   ├── music_classifier.py    # ML classification
│   └── analyze.py             # Entry point
│
├── uploads/                   # Uploaded MIDI files
├── package.json
├── requirements.txt
└── .env
```

## ONNX Models

Place your trained ONNX models in `python/models/`:
- `genre_classifier.onnx` - Music genre classification
- `emotion_classifier.onnx` - Emotion detection
- `instrument_classifier.onnx` - Instrument classification

Models expect a 64-dimensional feature vector:
- 12x Pitch class histogram
- 10x Basic features (tempo, velocity stats, duration, etc.)
- 8x Instrument presence features
- 8x Chord type features
- 26x Padding

If models are not found, the system falls back to rule-based heuristics.

## Database Schema

### Tables
- `analyses` - Main analysis records
- `style_tags` - Genre classification results
- `emotion_tags` - Emotion analysis results
- `instruments` - Detected instruments
- `chords` - Chord progression
- `notes` - Note events (sampled)
- `sections` - Song structure sections
- `batch_jobs` - Batch processing tracking

## Usage Example

1. **Upload MIDI Files**
   - Drag and drop or click to browse
   - Select up to 10 `.mid` or `.midi` files
   - Click "Analyze Files"

2. **View Results**
   - Watch real-time processing status
   - View waveform with playback controls
   - Explore style, emotion, and instrument analysis
   - See chord progression and song structure

3. **Export Reports**
   - Click download icon for individual reports
   - Select multiple analyses in History tab for batch export

## Troubleshooting

### Python Issues
```bash
# Check Python path
which python  # or where python on Windows

# Test MIDI parsing directly
python python/midi_parser.py path/to/file.mid
```

### Database Issues
```bash
# Test connection
psql -h localhost -U postgres -d midi_analyzer

# Verify pgcrypto extension
SELECT * FROM pg_extension WHERE extname = 'pgcrypto';
```

### Model Issues
- Models are optional - system works with heuristic fallback
- Ensure ONNX Runtime is compatible with your Python version

## License

MIT License - see LICENSE file for details.
