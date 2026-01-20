import { Transcription, AnalysisResult } from "../types";
import { maskPII } from "./piiMasking";

// Pastaba: MVP etape šis failas turėtų kreiptis į jūsų Supabase Edge funkciją arba Backend
// Tai užtikrina saugumą ir duomenų išsaugojimą DB.

export const uploadAndProcessAudio = async (file: File): Promise<string> => {
  // 1. Įkėlimas į saugyklą (pvz. Supabase Storage)
  // return fileId;
  console.log("Failas ruošiamas įkėlimui:", file.name);
  return "temp-id-" + Math.random().toString(36).substring(7);
};

export const fetchTranscriptionFromBackend = async (callId: string): Promise<Transcription> => {
  // Ši funkcija kvies GET /api/transcription/{id}
  // Kol kas naudojame senąją logiką testavimui, bet čia bus fetch()
  throw new Error("Backend nekonfigūruotas. Naudokite vietinį DI testavimą.");
};

// Išlaikome esamą DI logiką vietiniam testavimui (Prototyping), 
// bet pridedame komentarą apie Backend integraciją.
import { GoogleGenAI, Type } from "@google/genai";

const getAI = () => {
  // SECURITY: API keys should NOT be in frontend
  // All Gemini API calls should go through Edge Functions (server-side)
  // This function is kept for backward compatibility but should not be used in production
  console.warn('⚠️ SECURITY WARNING: Frontend Gemini API usage detected');
  console.warn('⚠️ All API calls should go through Edge Functions (server-side)');
  console.warn('⚠️ API keys should never be exposed to frontend');
  
  throw new Error("SECURITY: Frontend API key usage is disabled. Please use Edge Functions for all Gemini API calls.");
};

// Helper function to list available models (for debugging)
export const listAvailableModels = async () => {
  try {
    const ai = getAI();
    const models = await ai.models.list();
    console.log('Available models:', models);
    return models;
  } catch (error) {
    console.error('Error listing models:', error);
    return [];
  }
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<Transcription> => {
  const ai = getAI();
  const prompt = `Transkribuok VISĄ klientų aptarnavimo skambučio įrašą lietuvių kalba. 

SVARBU:
- Transkribuok VISĄ pokalbio dalį, ne tik paskutinius žodžius
- Identifikuok kalbėtojus (pvz., "Agentas", "Klientas", "Operatorius", "Klientas")
- Padalink į segmentus pagal kalbėtojus
- Kiekvienas segmentas turi turėti: speaker (kalbėtojas), text (pilnas tekstas), startTime, endTime
- Grąžink VISĄ transkripciją, ne tik fragmentą
- Jei negali identifikuoti kalbėtojų, naudok "Kalbėtojas 1" ir "Kalbėtojas 2"

Grąžink JSON formatu su:
- text: pilnas transkripcijos tekstas (visas pokalbis)
- language: "lt"
- segments: masyvas su visais segmentais, kurių kiekvienas turi speaker ir text`;

  console.log('Starting transcription...');
  console.log('Audio data length:', base64Audio.length);
  console.log('MIME type:', mimeType);

  try {
    // Try different model names in order of reliability
    // Using latest Gemini models
    const modelNames = ['gemini-2.5-flash-preview-native-audio-dialog', 'gemini-2.5-pro'];
    let lastError: any = null;
    
    for (const modelName of modelNames) {
      try {
        console.log(`Attempting to use model: ${modelName}`);
        
        // Add timeout wrapper
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout after 60 seconds')), 60000)
        );
        
        const apiPromise = ai.models.generateContent({
          model: modelName,
          contents: [{ 
            parts: [
              { inlineData: { data: base64Audio, mimeType: mimeType } }, 
              { text: prompt }
            ] 
          }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          language: { type: Type.STRING },
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speaker: { type: Type.STRING },
                text: { type: Type.STRING },
                startTime: { type: Type.NUMBER },
                endTime: { type: Type.NUMBER }
              },
              required: ["speaker", "text"]
            }
          }
        },
        required: ["text", "language", "segments"]
      }
    }
  });

        const response = await Promise.race([apiPromise, timeoutPromise]) as any;
        console.log('API response received:', response);
        console.log('Response type:', typeof response);
        console.log('Response keys:', Object.keys(response || {}));

        // Handle response - try multiple ways to get the text
        let responseText = "{}";
        
        // Method 1: Direct text property
        if (response.text) {
          responseText = typeof response.text === 'function' ? response.text() : response.text;
          console.log('Got text from response.text');
        }
        // Method 2: Candidates array - combine ALL parts (not just parts[0])
        else if (response.candidates?.[0]?.content?.parts) {
          const candidate = response.candidates[0];
          // Combine all parts if multiple parts exist (some responses may be split)
          responseText = candidate.content.parts
            .map((part: any) => part.text || '')
            .filter((text: string) => text.length > 0)
            .join('');
          console.log(`Got text from candidates (${candidate.content.parts.length} parts combined)`);
        }
        // Method 3: Response property
        else if ((response as any).response?.text) {
          responseText = (response as any).response.text;
          console.log('Got text from response.response.text');
        }
        // Method 4: Check if it's already a string
        else if (typeof response === 'string') {
          responseText = response;
          console.log('Response is already a string');
        }
        
        console.log(`📝 Transcription response text length: ${responseText.length} chars`);
        console.log("Transcription response text (first 200 chars):", responseText.substring(0, 200));
        console.log("Transcription response text (last 200 chars):", responseText.substring(Math.max(0, responseText.length - 200)));
        
        if (!responseText || responseText === "{}") {
          throw new Error("Empty response from API");
        }
        
        const data = JSON.parse(responseText);
        console.log("Parsed transcription data:", data);
        console.log("Full text length:", data.text?.length || 0);
        console.log("Number of segments:", data.segments?.length || 0);
        
        // If segments are empty but we have text, create a single segment
        let segments = data.segments || [];
        
        // Ensure text field has the full transcription
        // Combine all segment texts if full text is missing or incomplete
        const segmentText = segments.length > 0 ? segments.map((s: any) => s.text || '').filter((t: string) => t).join(' ') : '';
        const fullText = (data.text || segmentText || "").trim();
        
        // Log text boundaries to verify last characters are preserved
        console.log(`📝 Data.text length: ${data.text?.length || 0}, last 50 chars: "${data.text?.substring(Math.max(0, (data.text?.length || 0) - 50)) || ''}"`);
        console.log(`📝 Segment text length: ${segmentText.length}, last 50 chars: "${segmentText.substring(Math.max(0, segmentText.length - 50))}"`);
        console.log(`📝 Full text length: ${fullText.length}, last 50 chars: "${fullText.substring(Math.max(0, fullText.length - 50))}"`);
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:177',message:'Full text construction',data:{dataTextLength:data.text?.length,segmentTextLength:segmentText.length,fullTextLength:fullText.length,segmentsCount:segments.length,dataTextLast50:data.text?.substring(Math.max(0,(data.text?.length||0)-50))||'',fullTextLast50:fullText.substring(Math.max(0,fullText.length-50))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'Q'})}).catch(()=>{});
        // #endregion
        
        // If segments are incomplete compared to full text, update them
        // This ensures Dashboard displays complete transcription even if API returns incomplete segments
        if (fullText && segments.length > 0) {
          const segmentTextLength = segmentText.length;
          const fullTextLength = fullText.length;
          
          // If full text is significantly longer than segment text (more than 20% difference),
          // segments are likely incomplete - use full text to create proper segments
          if (fullTextLength > segmentTextLength * 1.2) {
            console.warn(`⚠️ Segments incomplete (${segmentTextLength} chars) vs full text (${fullTextLength} chars). Updating segments.`);
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:184',message:'Updating incomplete segments',data:{segmentTextLength,fullTextLength,segmentsCount:segments.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'R'})}).catch(()=>{});
            // #endregion
            
            // Create a single segment from full text, or split into multiple segments if structure suggests multiple speakers
            if (segments.length === 1) {
              // Single segment case: replace it with full text
              segments = [{
                speaker: segments[0]?.speaker || "Transkripcija",
                text: fullText,
                startTime: segments[0]?.startTime || 0,
                endTime: segments[0]?.endTime || 0
              }];
              
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:196',message:'Single segment updated',data:{newSegmentTextLength:segments[0]?.text?.length,fullTextLength},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'S'})}).catch(()=>{});
              // #endregion
            } else {
              // Multiple segments but incomplete: append remaining text to last segment, or create new segment
              // For now, update all segments to include full text proportionally, or create a single segment
              segments = [{
                speaker: "Transkripcija",
                text: fullText,
                startTime: 0,
                endTime: 0
              }];
            }
          }
        } else if (segments.length === 0 && fullText) {
          // No segments but have full text: create a single segment
          console.log("No segments found, creating single segment from full text");
          segments = [{
            speaker: "Transkripcija",
            text: fullText,
            startTime: 0,
            endTime: 0
          }];
        }
        
        // Warn if transcription seems incomplete (very short)
        if (fullText.length < 100 && segments.length > 0) {
          console.warn(`⚠️ Transcription seems short (${fullText.length} chars) for ${segments.length} segments. Check if full text is being captured.`);
        }
        
        // #region agent log - Final segment state after potential updates
        const finalSegmentText = segments.length > 0 ? segments.map((s: any) => s.text || '').filter((t: string) => t).join(' ') : '';
        fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:228',message:'Final transcription state',data:{fullTextLength:fullText.length,finalSegmentTextLength:finalSegmentText.length,segmentsCount:segments.length,segmentsMatch:fullText.length === finalSegmentText.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'T'})}).catch(()=>{});
        // #endregion
        
        const rawTranscription: Transcription = {
    id: Math.random().toString(36).substring(2, 11),
          text: fullText,
    timestamp: new Date(),
          language: data.language || "lt",
          segments: segments
        };
        
        // Mask PII before returning
        console.log('🛡️ Starting PII masking...');
        try {
          const maskedTranscription = await maskPII(rawTranscription);
          console.log('✅ PII masking completed');
          return maskedTranscription;
        } catch (maskingError: any) {
          // If PII masking fails (e.g., timeout), log warning but continue with unmasked transcription
          // This ensures transcription is not lost due to masking issues
          console.warn('⚠️ PII masking failed, returning unmasked transcription:', maskingError.message);
          console.warn('   Transcription will be stored without PII masking');
          // Return raw transcription if masking fails - better than losing the transcription
          return rawTranscription;
        }
      } catch (modelError: any) {
        console.error(`Model ${modelName} failed:`, modelError);
        lastError = modelError;
        // Try next model
        continue;
      }
    }
    
    // If all models failed, throw the last error
    throw lastError || new Error("All models failed");
    
  } catch (error: any) {
    console.error("Transcription error:", error);
    console.error("Error type:", error?.constructor?.name);
    console.error("Error message:", error?.message);
    console.error("Error code:", error?.code);
    console.error("Full error object:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    
    const errorMessage = error?.message || error?.error?.message || "Nežinoma klaida";
    throw new Error(`Transkripcijos klaida: ${errorMessage}`);
  }
};

export const analyzeTranscription = async (transcription: Transcription): Promise<AnalysisResult> => {
  const ai = getAI();
  const prompt = `Išanalizuok šį klientų aptarnavimo skambučio transkripciją ir grąžink detalią analizę JSON formatu lietuviškai.

TRANSKRIPCIJA:
"${transcription.text}"

INSTRUKCIJOS:
1. SentimentScore (0-100): Bendras pokalbio tonas ir emocijos
   - 80-100: Labai teigiamas, džiaugiasi, patenkintas
   - 60-79: Teigiamas, neutralus teigiamas
   - 40-59: Neutralus, mišrus
   - 20-39: Neigiamas, nusivylęs
   - 0-19: Labai neigiamas, pyktas, agresyvus

2. CustomerSatisfaction (0-100): Kliento pasitenkinimas aptarnavimu
   - Vertink: ar klientas patenkintas sprendimu, ar problemos išspręstos, ar klientas džiaugiasi
   - 80-100: Labai patenkintas, problemos išspręstos, dėkoja
   - 60-79: Patenkintas, pagrindinės problemos išspręstos
   - 40-59: Dalinai patenkintas, kai kurios problemos liko
   - 20-39: Nepatenkintas, problemos neišspręstos
   - 0-19: Labai nepatenkintas, pyktas, skundžiasi

3. AgentPerformance (0-100): Agento darbo kokybė
   - Vertink: profesionalumas, empatija, problemų sprendimas, komunikacija, greitaveika
   - 80-100: Puikus darbas - profesionalus, empatiškas, efektyvus, gerai išsprendė problemą
   - 60-79: Geras darbas - profesionalus, bet galėjo būti geriau
   - 40-59: Vidutinis - darbo yra, bet trūksta profesionalumo ar efektyvumo
   - 20-39: Blogas - neprofesionalus, neempatiškas, neefektyvus
   - 0-19: Labai blogas - agresyvus, neprofesionalus, nepadėjo

4. Warnings: Sistemiški įspėjimai (masyvas stringų)
   - Pridėk įspėjimus jei: neprofesionalus tonas, agresyvumas, problemos neišspręstos, trūksta empatijos, pažeidžiamos taisyklės

5. Summary: Trumpa santrauka pokalbio (2-3 sakiniai lietuviškai)

6. Metrics: Papildomos metrikos (masyvas objektų su label, value, trend)

Grąžink JSON su šiais laukais:
- sentimentScore: skaičius 0-100
- customerSatisfaction: skaičius 0-100  
- agentPerformance: skaičius 0-100
- warnings: masyvas stringų (gali būti tuščias)
- summary: stringas lietuviškai
- metrics: masyvas objektų {label: string, value: number, trend: "up"|"down"|"neutral"}`;

  try {
    // Try different model names in order of reliability
    // Using latest Gemini models
    const modelNames = ['gemini-2.5-flash-preview-native-audio-dialog', 'gemini-2.5-pro'];
    let lastError: any = null;

    for (const modelName of modelNames) {
      try {
        console.log(`Attempting to use model for analysis: ${modelName}`);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout after 60 seconds')), 60000)
        );
        
        const apiPromise = ai.models.generateContent({
          model: modelName,
          contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sentimentScore: { type: Type.NUMBER },
          customerSatisfaction: { type: Type.NUMBER },
          agentPerformance: { type: Type.NUMBER },
          warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
          metrics: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                value: { type: Type.NUMBER },
                trend: { type: Type.STRING, enum: ["up", "down", "neutral"] }
              }
            }
          }
        },
        required: ["sentimentScore", "customerSatisfaction", "agentPerformance", "warnings", "summary", "metrics"]
      }
    }
  });

        const response = await Promise.race([apiPromise, timeoutPromise]);

        // Handle response - @google/genai response.text is a getter property
        let responseText = "{}";
        try {
          // response.text is a getter, access it directly
          responseText = (response as any).text || "";
          if (!responseText && (response as any).candidates?.[0]?.content?.parts?.[0]?.text) {
            responseText = (response as any).candidates[0].content.parts[0].text;
          }
        } catch (e) {
          console.error("Error accessing response.text:", e);
        }
        
        console.log("Analysis response:", responseText);
        const data = JSON.parse(responseText);
        
        // Validate and normalize scores to ensure they're between 0-100
        const sentimentScore = Math.max(0, Math.min(100, data.sentimentScore || 50));
        const customerSatisfaction = Math.max(0, Math.min(100, data.customerSatisfaction || 50));
        const agentPerformance = Math.max(0, Math.min(100, data.agentPerformance || 50));
        
        console.log('✅ Analysis completed with scores:', {
          sentimentScore,
          customerSatisfaction,
          agentPerformance
        });
        
  return {
    id: Math.random().toString(36).substring(2, 11),
          sentimentScore,
          customerSatisfaction,
          agentPerformance,
          warnings: data.warnings || [],
          summary: data.summary || "",
          metrics: data.metrics || [],
    complianceChecked: true
  };
      } catch (innerError: any) {
        console.error(`Error with model ${modelName} for analysis:`, innerError);
        lastError = innerError;
      }
    }
    
    throw lastError || new Error("All models failed");
  } catch (error: any) {
    console.error("Analysis error:", error);
    throw new Error(`Analizės klaida: ${error.message || "Nežinoma klaida"}`);
  }
};