# Deployment Guide - VoxAnalyze MVP

Complete guide for deploying VoxAnalyze MVP to production.

## Prerequisites

- GitHub account
- Vercel account (free tier works)
- Supabase account
- Google Gemini API key

---

## Step 1: Prepare Your Code

### 1.1 Ensure All Files Are Committed

```bash
git status
git add .
git commit -m "Ready for production deployment"
```

### 1.2 Push to GitHub

```bash
git push origin main
```

---

## Step 2: Deploy Frontend to Vercel

### 2.1 Connect Repository

1. Go to [vercel.com](https://vercel.com)
2. Sign in with GitHub
3. Click **"Add New..."** → **"Project"**
4. Select your repository
5. Click **"Import"**

### 2.2 Configure Project

Vercel will auto-detect Vite. Verify these settings:

- **Framework Preset:** Vite
- **Root Directory:** `./`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

### 2.3 Set Environment Variables

In Project Settings → Environment Variables, add:

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_SUPABASE_URL` | Your Supabase project URL | `https://xxxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key | `eyJhbGci...` |

**Important:** 
- These are **public** keys (safe for frontend)
- Do NOT add `GEMINI_API_KEY` or `ENCRYPTION_KEY` here
- They belong in Supabase Edge Function secrets

### 2.4 Deploy

1. Click **"Deploy"**
2. Wait for build to complete (~2-3 minutes)
3. Your app will be live at `https://your-project.vercel.app`

### 2.5 Verify Deployment

- ✅ App loads without errors
- ✅ No console errors (F12 → Console)
- ✅ Login page appears
- ✅ Can navigate between tabs

---

## Step 3: Configure Supabase

### 3.1 Update CORS Settings

1. Go to Supabase Dashboard → Settings → API
2. Add your Vercel domain to **Allowed Origins**:
   ```
   https://your-project.vercel.app
   ```
3. Click **Save**

### 3.2 Set Edge Function Secrets

1. Go to Supabase Dashboard → Edge Functions → Settings → Secrets
2. Add secrets:

   | Secret Name | Description | How to Generate |
   |-------------|-------------|-----------------|
   | `GEMINI_API_KEY` | Google Gemini API key | Get from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
   | `ENCRYPTION_KEY` | 64-character hex string | Run: `openssl rand -hex 32` |

3. Click **Save** for each secret

### 3.3 Deploy Edge Functions

```bash
# Make sure you're logged in
supabase login

# Link to your project (if not already linked)
supabase link --project-ref your-project-ref

# Deploy all functions
supabase functions deploy upload
supabase functions deploy transcription
supabase functions deploy analysis
supabase functions deploy delete-record
supabase functions deploy security-audit
```

### 3.4 Verify Edge Functions

Test the upload function:
```bash
curl https://your-project.supabase.co/functions/v1/upload \
  -H "apikey: YOUR_ANON_KEY" \
  -X GET
```

Should return: `{"ok":true,"name":"upload",...}`

---

## Step 4: Test Production Deployment

### 4.1 Test Checklist

- [ ] **Authentication**
  - [ ] Can log in
  - [ ] Can log out
  - [ ] Session persists on refresh

- [ ] **File Upload**
  - [ ] Can upload audio file
  - [ ] Progress bar shows correctly
  - [ ] Processing completes successfully

- [ ] **Transcription**
  - [ ] Transcription appears in history
  - [ ] Shows dialogue format (Agent/Client)
  - [ ] All text is visible

- [ ] **Analysis**
  - [ ] Scores display correctly
  - [ ] Charts render properly
  - [ ] Summary is logical and privacy-protected

- [ ] **History**
  - [ ] Can view past records
  - [ ] Can delete records
  - [ ] Navigation works correctly

- [ ] **Security Audit** (Admin only)
  - [ ] Can access security audit tab
  - [ ] Audit runs successfully
  - [ ] Results display correctly

### 4.2 Common Issues

**Issue: CORS Errors**
- **Solution:** Add Vercel domain to Supabase CORS settings

**Issue: Environment Variables Not Loading**
- **Solution:** 
  - Check variables are set in Vercel dashboard
  - Redeploy after adding variables
  - Restart Vercel deployment

**Issue: Edge Functions Not Working**
- **Solution:**
  - Verify functions are deployed
  - Check secrets are set in Supabase
  - Review Edge Function logs in Supabase Dashboard

**Issue: Build Fails**
- **Solution:**
  - Check build logs in Vercel
  - Ensure all dependencies are in `package.json`
  - Verify Node.js version (should be 18+)

---

## Step 5: Custom Domain (Optional)

### 5.1 Add Domain in Vercel

1. Go to Project Settings → Domains
2. Add your custom domain
3. Follow DNS configuration instructions
4. Wait for SSL certificate (automatic)

### 5.2 Update CORS

Add your custom domain to Supabase CORS settings:
```
https://your-custom-domain.com
```

---

## Step 6: Monitoring & Maintenance

### 6.1 Monitor Deployments

- Check Vercel dashboard for build status
- Review deployment logs
- Monitor Edge Function logs in Supabase

### 6.2 Update Deployment

1. Make changes locally
2. Test locally
3. Commit and push to GitHub
4. Vercel auto-deploys (or trigger manually)

### 6.3 Update Edge Functions

```bash
# Make changes to Edge Functions
# Then deploy:
supabase functions deploy <function-name>
```

---

## Environment Variables Reference

### Frontend (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ Yes | Supabase anonymous key |

### Backend (Supabase Edge Functions)

| Secret | Required | Description |
|--------|----------|-------------|
| `GEMINI_API_KEY` | ✅ Yes | Google Gemini API key |
| `ENCRYPTION_KEY` | ✅ Yes | 64-char hex encryption key |

---

## Rollback Procedure

### Rollback Frontend

1. Go to Vercel Dashboard → Deployments
2. Find previous working deployment
3. Click "..." → "Promote to Production"

### Rollback Edge Functions

```bash
# Deploy previous version
supabase functions deploy <function-name> --version <version-number>
```

---

## Support

If you encounter issues:

1. Check Vercel build logs
2. Check Supabase Edge Function logs
3. Review browser console (F12)
4. Check Supabase Dashboard → Functions → Logs

---

**Last Updated:** January 2025
