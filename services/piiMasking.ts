import { GoogleGenAI, Type } from "@google/genai";
import { Transcription } from "./types";

const getAI = () => {
  // Try multiple ways to get the API key
  const apiKey = (process.env as any)?.API_KEY 
    || (import.meta as any).env?.VITE_API_KEY
    || "";
  
  if (!apiKey) {
    throw new Error("API_KEY nerastas. Prašome sukurti .env.local failą su jūsų Gemini API raktu.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Masks PII (Personally Identifiable Information) from transcription text.
 * Identifies and replaces:
 * - Names → [NAME]
 * - Surnames → [SURNAME]
 * - Lithuanian person codes (11 digits) → [PERSON_CODE]
 * - Email addresses → [EMAIL]
 * - Phone numbers → [PHONE]
 * - Addresses → [ADDRESS]
 * - Credit card numbers → [CARD_NUMBER]
 * - Bank account numbers → [ACCOUNT_NUMBER]
 * - Other sensitive information
 */
export const maskPII = async (transcription: Transcription): Promise<Transcription> => {
  const ai = getAI();
  
  // Prepare the prompt for PII detection and masking
  const prompt = `Išanalizuok šį lietuvių kalba transkribuotą pokalbį ir identifikuok VISĄ asmeninę ir slaptą informaciją (PII):
- Vardus (pvz., Jonas, Marija, Petras) → pakeisk į [NAME]
- Pavardes (pvz., Petraitis, Kazlauskas, Jankauskas) → pakeisk į [SURNAME]
- Asmens kodus (11 skaitmenų, pvz., 12345678901 arba 123456-78901) → pakeisk į [PERSON_CODE]
- El. pašto adresus (pvz., jonas@example.com) → pakeisk į [EMAIL]
- Telefono numerius (pvz., +370 123 45678, 861234567, 8 612 34567) → pakeisk į [PHONE]
- Adresus (miestas, gatvė, namo numeris) → pakeisk į [ADDRESS]
- Kreditinių kortelių numerius (16 skaitmenų) → pakeisk į [CARD_NUMBER]
- Banko sąskaitos numerius (LT formatas arba kiti) → pakeisk į [ACCOUNT_NUMBER]
- Bet kokią kitą slaptą ar asmeninę informaciją

SVARBU:
- Pakeisk VISAS PII įrašus, ne tik pirmąjį
- Išlaikyk originalų teksto formatavimą ir struktūrą
- Jei tekste nėra PII, grąžink originalų tekstą be pakeitimų
- Taip pat pakeisk PII segmentų tekstuose
- Būk atsargus - geriau pažymėti kaip PII nei praleisti

TEKSTAS:
"${transcription.text}"

Grąžink TIK pakeistą tekstą be jokių paaiškinimų ar komentarų.`;

  try {
    // Try different model names in order of reliability
    const modelNames = ['gemini-2.5-flash-preview-native-audio-dialog', 'gemini-2.5-pro'];
    let lastError: any = null;

    for (const modelName of modelNames) {
      try {
        console.log(`Attempting PII masking with model: ${modelName}`);
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'piiMasking.ts:63',message:'PII masking attempt',data:{modelName,textLength:transcription.text?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'L'})}).catch(()=>{});
        // #endregion
        
        // Increase timeout for PII masking (90 seconds instead of 60)
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('PII masking timeout after 90 seconds')), 90000)
        );
        
        const apiPromise = ai.models.generateContent({
          model: modelName,
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "text/plain"
          }
        });
        
        const response = await Promise.race([apiPromise, timeoutPromise]) as any;
        
        // Get the masked text from response
        let maskedText = "";
        if (response.text) {
          maskedText = typeof response.text === 'function' ? response.text() : response.text;
        } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
          maskedText = response.candidates[0].content.parts[0].text;
        } else if (typeof response === 'string') {
          maskedText = response;
        }
        
        // Clean up the response (remove any surrounding quotes or extra whitespace)
        maskedText = maskedText.trim().replace(/^["']|["']$/g, '');
        
        if (!maskedText || maskedText.length === 0) {
          throw new Error("Empty response from PII masking API");
        }
        
        console.log(`✅ PII masking completed (${maskedText.length} chars)`);
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'piiMasking.ts:96',message:'PII masking success',data:{modelName,maskedTextLength:maskedText.length,originalLength:transcription.text?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'M'})}).catch(()=>{});
        // #endregion
        
        // Mask PII in segments as well
        const maskedSegments = transcription.segments?.map(segment => {
          // Simple approach: try to find the segment text in the masked text
          // If found, use that portion; otherwise, apply basic masking to segment
          let maskedSegmentText = segment.text;
          
          // Check if this segment's text appears in the original transcription
          const segmentIndex = transcription.text.indexOf(segment.text);
          if (segmentIndex >= 0) {
            // Try to extract the corresponding masked portion
            // This is approximate but should work for most cases
            const beforeSegment = transcription.text.substring(0, segmentIndex);
            const maskedBefore = maskedText.substring(0, Math.min(beforeSegment.length, maskedText.length));
            const remainingLength = Math.min(segment.text.length, maskedText.length - maskedBefore.length);
            if (remainingLength > 0) {
              maskedSegmentText = maskedText.substring(
                maskedBefore.length,
                maskedBefore.length + remainingLength
              );
            }
          } else {
            // Segment text not found in main text, mask it separately with regex patterns
            maskedSegmentText = maskSegmentText(segment.text);
          }
          
          return {
            ...segment,
            text: maskedSegmentText
          };
        }) || [];
        
        // Build result with masked transcription
        const maskedTranscription: Transcription = {
          ...transcription,
          text: maskedText,
          segments: maskedSegments
        };
        
        return maskedTranscription;
        
      } catch (modelError: any) {
        console.error(`Model ${modelName} failed for PII masking:`, modelError);
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'piiMasking.ts:131',message:'PII masking model failed',data:{modelName,errorMessage:modelError?.message,errorType:modelError?.constructor?.name,willTryNext:modelNames.indexOf(modelName)<modelNames.length-1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'N'})}).catch(()=>{});
        // #endregion
        
        lastError = modelError;
        continue;
      }
    }
    
    // If all models failed, apply basic regex-based masking as fallback
    console.warn("⚠️ Gemini PII masking failed, using regex fallback");
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'piiMasking.ts:142',message:'PII masking fallback to regex',data:{lastError:lastError?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'O'})}).catch(()=>{});
    // #endregion
    
    return maskWithRegex(transcription);
    
  } catch (error: any) {
    console.error("PII masking error:", error);
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'piiMasking.ts:152',message:'PII masking error caught',data:{errorMessage:error?.message,errorType:error?.constructor?.name,willUseFallback:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'P'})}).catch(()=>{});
    // #endregion
    
    // Fallback to regex-based masking if AI fails (including timeouts)
    console.warn("⚠️ Using regex fallback for PII masking due to:", error.message);
    return maskWithRegex(transcription);
  }
};

/**
 * Fallback regex-based PII masking
 * Less accurate than AI-based masking but works without API calls
 */
function maskWithRegex(transcription: Transcription): Transcription {
  let maskedText = transcription.text;
  
  // Mask email addresses
  maskedText = maskedText.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
  
  // Mask phone numbers (Lithuanian and international formats)
  // +370, 8, or international formats
  maskedText = maskedText.replace(/(?:\+370|8)?\s*(?:\(\d+\))?\s*\d{1,3}\s*\d{2,3}\s*\d{3,4}\s*\d{0,4}/g, '[PHONE]');
  maskedText = maskedText.replace(/\b\d{3}\s*\d{3}\s*\d{4}\b/g, '[PHONE]'); // Alternative format
  maskedText = maskedText.replace(/\b\d{8,10}\b/g, (match) => {
    // Only mask if it looks like a phone number (8-10 digits)
    return match.length >= 8 ? '[PHONE]' : match;
  });
  
  // Mask Lithuanian person codes (11 digits, with or without hyphen)
  // Pattern: 6 digits + optional hyphen + 5 digits
  maskedText = maskedText.replace(/\b\d{6}-?\d{5}\b/g, '[PERSON_CODE]');
  
  // Mask credit card numbers (16 digits, possibly with spaces/dashes)
  maskedText = maskedText.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD_NUMBER]');
  
  // Mask bank account numbers (Lithuanian LT format: LT + 20 digits)
  maskedText = maskedText.replace(/\bLT\d{2}\d{5}\d{11}\b/g, '[ACCOUNT_NUMBER]');
  maskedText = maskedText.replace(/\b\d{16,20}\b/g, (match) => {
    // Mask long number sequences that might be account numbers
    return match.length >= 16 ? '[ACCOUNT_NUMBER]' : match;
  });
  
  // For names and surnames, we'll use a simpler approach
  // Note: This is less accurate than AI-based detection
  // We could expand this with common Lithuanian name patterns if needed
  
  // Mask segments
  const maskedSegments = transcription.segments?.map(segment => ({
    ...segment,
    text: maskSegmentText(segment.text)
  })) || [];
  
  return {
    ...transcription,
    text: maskedText,
    segments: maskedSegments
  };
}

/**
 * Apply regex-based masking to a segment text
 */
function maskSegmentText(text: string): string {
  let masked = text;
  
  // Mask email addresses
  masked = masked.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
  
  // Mask phone numbers
  masked = masked.replace(/(?:\+370|8)?\s*(?:\(\d+\))?\s*\d{1,3}\s*\d{2,3}\s*\d{3,4}\s*\d{0,4}/g, '[PHONE]');
  masked = masked.replace(/\b\d{3}\s*\d{3}\s*\d{4}\b/g, '[PHONE]');
  masked = masked.replace(/\b\d{8,10}\b/g, (match) => {
    return match.length >= 8 ? '[PHONE]' : match;
  });
  
  // Mask Lithuanian person codes
  masked = masked.replace(/\b\d{6}-?\d{5}\b/g, '[PERSON_CODE]');
  
  // Mask credit card numbers
  masked = masked.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD_NUMBER]');
  
  // Mask bank account numbers
  masked = masked.replace(/\bLT\d{2}\d{5}\d{11}\b/g, '[ACCOUNT_NUMBER]');
  masked = masked.replace(/\b\d{16,20}\b/g, (match) => {
    return match.length >= 16 ? '[ACCOUNT_NUMBER]' : match;
  });
  
  return masked;
}
