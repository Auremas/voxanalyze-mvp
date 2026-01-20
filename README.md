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
cp .env.example .env.local
# Edit .env.local with your keys
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

### Frontend (Vercel)

#### Option 1: Deploy via Vercel Dashboard (Recommended)

1. **Push code to GitHub:**
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Connect to Vercel:**
   - Go to [vercel.com](https://vercel.com) and sign in
   - Click "Add New..." → "Project"
   - Import your GitHub repository
   - Vercel will auto-detect Vite framework

3. **Configure Build Settings:**
   - Framework Preset: **Vite** (auto-detected)
   - Root Directory: `./` (default)
   - Build Command: `npm run build` (auto-detected)
   - Output Directory: `dist` (auto-detected)
   - Install Command: `npm install` (auto-detected)

4. **Set Environment Variables:**
   - Go to Project Settings → Environment Variables
   - Add:
     - `VITE_SUPABASE_URL` = Your Supabase project URL
     - `VITE_SUPABASE_ANON_KEY` = Your Supabase anon key
   - Click "Save"

5. **Deploy:**
   - Click "Deploy"
   - Wait for build to complete
   - Your app will be live at `https://your-project.vercel.app`

#### Option 2: Deploy via Vercel CLI

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Login:**
   ```bash
   vercel login
   ```

3. **Deploy:**
   ```bash
   vercel
   ```

4. **Set environment variables:**
   ```bash
   vercel env add VITE_SUPABASE_URL
   vercel env add VITE_SUPABASE_ANON_KEY
   ```

5. **Deploy to production:**
   ```bash
   vercel --prod
   ```

#### Post-Deployment Checklist

- ✅ Verify app loads at your Vercel URL
- ✅ Test login functionality
- ✅ Test file upload
- ✅ Check browser console for errors
- ✅ Update CORS settings in Supabase (add your Vercel domain)

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
- **Hosting:** Vercel (frontend), Supabase Cloud (backend)

## Features

- ✅ Audio transcription with speaker identification
- ✅ AI-powered sentiment analysis
- ✅ Customer satisfaction scoring
- ✅ Agent performance evaluation
- ✅ Compliance warnings
- ✅ Privacy-protected summaries
- ✅ Security audit (admin)

## License

[Your License Here]
