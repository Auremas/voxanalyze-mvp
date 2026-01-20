# VoxAnalyze MVP

AI-powered call center quality assurance system for automatic call transcription and analysis.

## Quick Start

### Prerequisites
- Node.js 18+
- Supabase CLI (for local development)
- Docker (for local Supabase)

### Installation

1. **Clone and install:**
```bash
git clone <repository-url>
cd voxanalyze-mvp
npm install
```

2. **Set up environment:**
```bash
# Copy the example file
cp .env.example .env.local

# Edit .env.local and add your Supabase anon key:
# - Get it from: Supabase Dashboard → Settings → API → anon public
# - Replace "your-anon-key-here" with your actual key
```

3. **Start local development:**
```bash
# Start Supabase locally
npm run supabase:start

# Start Edge Functions (in separate terminal)
npm run dev:functions

# Start frontend (in separate terminal)
npm run dev
```

Or run everything together:
```bash
npm run dev:all
```

Access at: `http://localhost:5173`

## Available Scripts

- `npm run dev` - Start frontend development server
- `npm run dev:functions` - Start local Edge Functions
- `npm run dev:all` - Start frontend + Edge Functions
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run supabase:start` - Start local Supabase
- `npm run supabase:stop` - Stop local Supabase

## Deployment

### Backend (Supabase)
```bash
supabase functions deploy upload
supabase functions deploy transcription
supabase functions deploy analysis
supabase functions deploy delete-record
supabase functions deploy security-audit
```

Set secrets in Supabase Dashboard:
- `GEMINI_API_KEY`
- `ENCRYPTION_KEY`

## Documentation

See [DOCUMENTATION.md](./DOCUMENTATION.md) for complete documentation.

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **Backend:** Supabase (PostgreSQL, Edge Functions)
- **AI:** Google Gemini API
- **Hosting:** Supabase Cloud (backend)

## Features

- ✅ Audio transcription with speaker identification
- ✅ AI-powered sentiment analysis
- ✅ Customer satisfaction scoring
- ✅ Agent performance evaluation
- ✅ Compliance warnings
- ✅ Privacy-protected summaries
- ✅ Security audit (admin)
