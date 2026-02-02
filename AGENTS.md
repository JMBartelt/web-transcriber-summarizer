## Project Description
AutoScribe is a web-based transcriber and SOAP notes generator for physical therapy sessions. It records audio in the browser, streams chunks to the server for Whisper transcription, and generates structured SOAP notes via OpenAI chat completions. This repo was forked from `wavtools`; the original README is now `WAVTOOLS_README.md`.

## Repo Index
- `server.js`: Express API for authentication, transcription, and SOAP note generation.
- `public/`: Static web UI (recording controls, transcript + notes output).
- `uploads/`: Temp audio chunks (multer); cleaned after transcription.
- `lib/`, `script/`, `dist/`: wavtools recording/streaming library and build artifacts.
- `index.js`: Library entrypoint.
- `deployment-guide.md`: Replit deployment steps.

## Tech Stack
- Backend: Node.js, Express, multer, node-fetch, dotenv, express-rate-limit.
- AI: OpenAI Whisper transcription + chat completions for SOAP notes.
- Frontend: Vanilla JS + Tailwind CDN in `public/index.html`.
- Build: TypeScript + esbuild (for wavtools bundles).