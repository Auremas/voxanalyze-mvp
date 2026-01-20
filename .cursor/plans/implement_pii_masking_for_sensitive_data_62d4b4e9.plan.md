---
name: Implement PII Masking for Sensitive Data
overview: Implement PII (Personally Identifiable Information) masking to redact names, surnames, and person codes from transcriptions before storing in Supabase. Uses Gemini AI to identify and replace PII with placeholders like [NAME], [SURNAME], [PERSON_CODE] to comply with privacy regulations.
todos:
  - id: "1"
    content: Create PII masking service (services/piiMasking.ts) that uses Gemini to identify and mask PII
    status: completed
  - id: "2"
    content: Integrate PII masking into client-side transcription flow (services/geminiService.ts)
    status: completed
    dependencies:
      - "1"
  - id: "3"
    content: Integrate PII masking into Edge Function upload flow (supabase/functions/upload/index.ts)
    status: completed
    dependencies:
      - "1"
  - id: "4"
    content: Test PII masking with Lithuanian names, surnames, and person codes
    status: completed
    dependencies:
      - "2"
      - "3"
---

# PII Masking Implementation Plan

## Overview

Mask sensitive PII (names, surnames, person codes) from transcriptions before storing in Supabase. Use Gemini AI to identify and replace PII with placeholders: `[NAME]`, `[SURNAME]`, `[PERSON_CODE]`.

## Architecture

```
Transcription Flow:
1. Audio → Gemini (Transcribe) → Raw Transcription
2. Raw Transcription → Gemini (PII Detection) → Masked Transcription
3. Masked Transcription → Supabase (Storage)
4. Analysis uses Masked Transcription
```

## Implementation Steps

### 1. Create PII Masking Service

**File:** `services/piiMasking.ts`

Create a new service that:

- Takes raw transcription text as input
- Uses Gemini AI to identify PII (names, surnames, person codes)
- Replaces identified PII with placeholders:
  - Names → `[NAME]`
  - Surnames → `[SURNAME]`
  - Person codes (11 digits, e.g., 12345678901 or 123456-78901) → `[PERSON_CODE]`
- Returns masked transcription with same structure (segments, text)
- Handles Lithuanian names and person codes

**Key features:**

- Use Gemini with structured output to identify PII positions
- Maintain original structure (segments, speakers, timestamps)
- Mask both in `text` field and each segment's `text` field

### 2. Update Transcription Flow - Client Service

**File:** `services/geminiService.ts`

Add masking step after transcription:

- After `transcribeAudio` receives raw transcription
- Call PII masking service before returning
- Return masked transcription instead of raw

### 3. Update Transcription Flow - Edge Function

**File:** `supabase/functions/upload/index.ts`

Add masking step after transcription:

- After receiving transcription from Gemini API
- Call PII masking (using Gemini API directly in Edge Function)
- Use masked transcription for storage and analysis

### 4. Update Types (Optional)

**File:** `types.ts`

Optionally add metadata to track masking:

```typescript
interface Transcription {
  // ... existing fields
  piiMasked?: boolean; // Flag to indicate if PII was masked
}
```

### 5. Update Analysis Flow

**Files:** `services/geminiService.ts`, `supabase/functions/upload/index.ts`

Ensure analysis works with masked transcriptions:

- Analysis already receives masked transcription (since masking happens before analysis)
- Verify analysis prompts work correctly with placeholders
- Test that sentiment/performance analysis isn't affected by masking

## PII Detection Strategy

### Using Gemini AI for PII Detection:

1. Send raw transcription to Gemini
2. Prompt: "Identify PII: names, surnames, Lithuanian person codes (11 digits)"
3. Request structured output with positions/ranges
4. Replace identified PII with placeholders
5. Return masked transcription

### Lithuanian Person Code Format:

- 11 digits: `12345678901`
- With hyphen: `123456-78901`
- Pattern: 6 digits + optional hyphen + 5 digits

### Name/Surname Detection:

- Use Gemini's natural language understanding
- Identify proper nouns that are likely names
- Consider context (e.g., "Mano vardas yra..." = "My name is...")

## Files to Modify

1. **New file:** `services/piiMasking.ts` - PII masking service
2. **Modify:** `services/geminiService.ts` - Add masking after transcription
3. **Modify:** `supabase/functions/upload/index.ts` - Add masking after transcription
4. **Optional:** `types.ts` - Add PII masking metadata

## Testing Considerations

- Test with Lithuanian names and surnames
- Test with various person code formats
- Verify masking doesn't break transcription structure
- Verify analysis quality with masked data
- Test edge cases: no PII, only partial PII, etc.

## Privacy Compliance

✅ **PII removed before storage** - Only masked versions stored

✅ **No original PII retained** - Original transcription discarded after masking

✅ **Analysis on masked data** - All downstream processes use masked data

✅ **Display shows masked version** - Users never see original PII

## Example Transformation

**Before masking:**

```
"Labas, mano vardas Jonas Petraitis, mano asmens kodas 12345678901."
```

**After masking:**

```
"Labas, mano vardas [NAME] [SURNAME], mano asmens kodas [PERSON_CODE]."
```