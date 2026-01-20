# Vercel Deployment Checklist

Quick checklist for deploying to Vercel.

## Pre-Deployment

- [ ] Code is committed and pushed to GitHub
- [ ] All tests pass locally
- [ ] Build succeeds: `npm run build`
- [ ] Environment variables documented

## Vercel Setup

- [ ] Create Vercel account (or sign in)
- [ ] Connect GitHub repository
- [ ] Import project
- [ ] Verify auto-detected settings:
  - [ ] Framework: Vite ✅
  - [ ] Build Command: `npm run build` ✅
  - [ ] Output Directory: `dist` ✅

## Environment Variables

Set in Vercel Dashboard → Project Settings → Environment Variables:

- [ ] `VITE_SUPABASE_URL` = Your Supabase project URL
- [ ] `VITE_SUPABASE_ANON_KEY` = Your Supabase anon key

**Important:** Do NOT add `GEMINI_API_KEY` or `ENCRYPTION_KEY` here (they go in Supabase secrets)

## Supabase Configuration

- [ ] Edge Functions deployed:
  - [ ] `upload`
  - [ ] `transcription`
  - [ ] `analysis`
  - [ ] `delete-record`
  - [ ] `security-audit`

- [ ] Edge Function secrets set:
  - [ ] `GEMINI_API_KEY`
  - [ ] `ENCRYPTION_KEY`

- [ ] CORS configured:
  - [ ] Add Vercel domain to Supabase allowed origins
  - [ ] Format: `https://your-project.vercel.app`

## Deploy

- [ ] Click "Deploy" in Vercel
- [ ] Wait for build to complete (~2-3 minutes)
- [ ] Check build logs for errors

## Post-Deployment Testing

- [ ] App loads at Vercel URL
- [ ] No console errors (F12 → Console)
- [ ] Login works
- [ ] File upload works
- [ ] Transcription displays correctly
- [ ] Analysis results show
- [ ] History works
- [ ] Delete works
- [ ] Security audit works (admin)

## Troubleshooting

If something doesn't work:

1. **Check Vercel build logs** - Look for errors
2. **Check browser console** - F12 → Console tab
3. **Check Supabase logs** - Dashboard → Functions → Logs
4. **Verify environment variables** - Make sure they're set correctly
5. **Check CORS** - Ensure Vercel domain is in Supabase allowed origins

## Quick Commands

```bash
# Test build locally
npm run build

# Deploy Edge Functions
supabase functions deploy upload
supabase functions deploy transcription
supabase functions deploy analysis
supabase functions deploy delete-record
supabase functions deploy security-audit

# Check Supabase status
supabase status
```

---

**Ready to deploy?** Follow the steps above and you're good to go! 🚀
