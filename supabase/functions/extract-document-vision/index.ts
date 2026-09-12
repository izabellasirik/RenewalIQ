// Supabase Edge Function: extract-document-vision
//
// Sends a broker-uploaded image to Anthropic's vision-capable Claude models for layout-aware
// structured extraction, and returns the result as JSON. This function exists ONLY because a
// secret API key can never live in the RenewalIQ frontend (a Vite app ships everything it's given
// straight to the browser) — this Edge Function is the one place that key is allowed to exist,
// read from an Edge Function secret (never a VITE_-prefixed variable, never committed).
//
// Auth: Supabase verifies the caller's JWT before this function body runs (the default for every
// Edge Function unless deployed with --no-verify-jwt, which this one deliberately is NOT) — so an
// anonymous request never reaches here, and never reaches the metered Anthropic API. Deploy and
// invoke this normally; do not add --no-verify-jwt.
//
// Deployment (see the chat report for full instructions):
//   supabase functions deploy extract-document-vision
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   (optional) supabase secrets set ANTHROPIC_VISION_MODEL=claude-sonnet-5

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;

// ~4MB of base64 (≈3MB raw image) — comfortably above what the client ever sends (images are
// resized client-side before upload) while still bounding request size/cost per call.
const MAX_BASE64_LENGTH = 4_000_000;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const DOCUMENT_TYPES = [
  'application',
  'loss_run',
  'vehicle_schedule',
  'driver_schedule',
  'financials',
  'driver_license',
  'vehicle_registration',
  'insurance_id_card',
  'insurance_declarations',
  'other',
] as const;

const SCALAR_FIELD_PATHS = [
  'business.namedInsured',
  'business.legalEntity',
  'business.dba',
  'business.fein',
  'business.address',
  'business.city',
  'business.state',
  'business.zip',
  'business.yearsInBusiness',
  'business.annualRevenue',
  'business.descriptionOfOperations',
  'transportation.dotNumber',
  'transportation.mcNumber',
  'transportation.fleetSize',
  'transportation.vehicleTypes',
  'transportation.statesOfOperation',
  'transportation.operatingRadius',
  'transportation.commoditiesHauled',
  'transportation.driverCount',
  'transportation.minDriverAge',
  'transportation.minDriverExperienceYears',
  'transportation.telematics',
  'transportation.dashcams',
  'coverageLine',
  'coverage.auto_liability.requestedLimit',
  'coverage.auto_liability.currentLimit',
  'coverage.motor_truck_cargo.requestedLimit',
  'coverage.motor_truck_cargo.currentLimit',
  'coverage.physical_damage.requestedLimit',
  'coverage.physical_damage.currentLimit',
  'coverage.general_liability.requestedLimit',
  'coverage.general_liability.currentLimit',
  'coverage.warehouse_legal_liability.requestedLimit',
  'coverage.warehouse_legal_liability.currentLimit',
] as const;

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

// Kept in sync by hand with src/services/ingestion/visionExtraction.ts's VisionExtractionResult —
// this is the contract between the two. The client independently re-validates every field against
// its own format rules (dates, VINs, state codes, ...) before trusting any of it, so this schema
// only needs to constrain shape/enums, not full business-rule correctness.
const RESPONSE_TOOL = {
  name: 'extracted_submission_data',
  description: 'Structured data read directly from an insurance-submission-related image (a driver license, vehicle registration, insurance card, declarations page, loss run, driver/vehicle schedule, W-9, application, screenshot, or other document).',
  input_schema: {
    type: 'object',
    properties: {
      documentType: { type: 'string', enum: DOCUMENT_TYPES },
      documentTypeConfidence: { type: 'string', enum: CONFIDENCE_LEVELS },
      scalarFields: {
        type: 'array',
        description: 'Business/transportation/coverage fields with a defined home in the risk profile. Only include a field you can actually read — never invent a value for a fieldPath just because it exists in this list.',
        items: {
          type: 'object',
          properties: {
            fieldPath: { type: 'string', enum: SCALAR_FIELD_PATHS },
            value: { description: 'string, number, boolean, or array of strings depending on the field' },
            confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
          },
          required: ['fieldPath', 'value', 'confidence'],
        },
      },
      driver: {
        type: 'object',
        description: "Present only if the image shows a driver's license/CDL or a driver-identity section. Omit any sub-field you cannot clearly read — never guess.",
        properties: {
          name: { type: 'string' },
          dob: { type: 'string', description: 'As printed, e.g. MM/DD/YYYY' },
          address: { type: 'string' },
          licenseState: { type: 'string' },
          licenseNumber: { type: 'string' },
          licenseClass: { type: 'string' },
          isCDL: { type: 'boolean' },
          issueDate: { type: 'string' },
          expirationDate: { type: 'string' },
          restrictions: { type: 'string' },
          endorsements: { type: 'string' },
          fieldConfidence: { type: 'object', description: 'Per-field confidence, keyed by the sub-field name above (e.g. {"expirationDate":"low"}).' },
        },
      },
      vehicle: {
        type: 'object',
        description: 'Present only if the image shows a vehicle registration or vehicle-identity section.',
        properties: {
          vin: { type: 'string' },
          make: { type: 'string' },
          model: { type: 'string' },
          year: { type: 'number' },
          plate: { type: 'string' },
          value: { type: 'number' },
          fieldConfidence: { type: 'object' },
        },
      },
      lossEntries: {
        type: 'array',
        description: 'Present only if the image shows a loss run / claims history.',
        items: {
          type: 'object',
          properties: {
            lossDate: { type: 'string' },
            claimType: { type: 'string' },
            paid: { type: 'number' },
            reserved: { type: 'number' },
            incurred: { type: 'number' },
            status: { type: 'string', enum: ['open', 'closed'] },
            confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
          },
        },
      },
      candidateNotes: {
        type: 'string',
        description: "Anything else clearly readable that doesn't fit a field above (e.g. the document doesn't match a known template) — a company name, DOT number, city/state, phone number, etc. Never leave a readable document at zero extracted information just because it isn't a recognized template.",
      },
    },
    required: ['documentType', 'documentTypeConfidence', 'scalarFields'],
  },
};

const SYSTEM_PROMPT = `You are the image-understanding step of Renewal IQ, a commercial trucking insurance submission tool. Brokers upload photos and screenshots of driver's licenses, vehicle registrations, insurance ID cards, declarations pages, loss runs, driver/vehicle schedules, W-9s, applications, and email/text screenshots — often phone photos with imperfect angle, lighting, or resolution.

Read the image and call the extracted_submission_data tool with what you can actually see. Rules that matter more than completeness:

1. NEVER guess or hallucinate a character, digit, or word you cannot clearly read. If part of a field is legible and part isn't, omit the whole field rather than filling in a plausible-looking guess — a wrong value is worse than a missing one. This applies especially to identifiers (license numbers, VINs, DOT/MC numbers) and dates, where a single wrong character is a real, harmful error.
2. Classify the document type as best you can from what's visible — do not rely on or ask about any filename.
3. If the document doesn't match a known template (documentType "other"), still extract any clearly readable business-identifying information (company name, DOT number, address, phone) into scalarFields, and note anything else readable in candidateNotes. A document not matching a template is never a reason to return nothing.
4. If the image is only partially readable (glare, blur, cropping, an unclear field), extract every field that IS legible and simply omit the ones that aren't — never discard the whole document because one part is unclear.
5. Give each field's own confidence rather than one confidence for the whole document — a name read with total certainty and a smudged expiration date should not share a confidence level.
6. A driver's own personal fields (name, DOB, address, license info) belong ONLY in the driver object, never in scalarFields' business.* paths — a driver's license is not the submission's business information.
7. business.dba: ONLY include this if the document explicitly labels a value as a DBA, "d/b/a", trade name, assumed name, or fictitious business name (e.g. a W-9's "Business name/disregarded entity name, if different from above" line, or an application's "DBA:" field). Never infer a DBA from the named insured, a nickname mentioned in passing, or any other unlabeled text. Leave this out entirely if the document has no such explicit label — it is genuinely optional and a missing DBA is not a gap.
8. business.fein: ONLY include this if the value is clearly labeled FEIN, EIN, "Employer Identification Number", "Federal Tax ID", or (on a W-9) the "Employer identification number" box specifically — never the adjacent "Social Security Number" box on the same form, even though both are 9 digits. It must read as exactly 9 digits (formatted either XX-XXXXXXX or as 9 plain digits); if you cannot clearly read all 9 digits or the label is ambiguous, omit the field rather than guessing. Never copy a DOT number, MC number, phone number, or any other digit string into this field just because it is 9 digits long.`;

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    // Deliberately vague to the client (never confirm/deny internal config specifics beyond this),
    // but explicit enough server-side (via the Supabase function logs) to diagnose quickly.
    console.error('extract-document-vision: ANTHROPIC_API_KEY is not set');
    return jsonResponse({ error: 'Vision extraction is not configured on this project yet.' }, 503);
  }

  let body: { imageBase64?: string; mimeType?: string; fileName?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { imageBase64, mimeType, fileName } = body;
  if (!imageBase64 || typeof imageBase64 !== 'string') return jsonResponse({ error: 'imageBase64 is required' }, 400);
  if (imageBase64.length > MAX_BASE64_LENGTH) return jsonResponse({ error: 'Image is too large' }, 400);
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) return jsonResponse({ error: 'Unsupported image type' }, 400);

  const model = Deno.env.get('ANTHROPIC_VISION_MODEL') || DEFAULT_MODEL;

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [RESPONSE_TOOL],
        tool_choice: { type: 'tool', name: RESPONSE_TOOL.name },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
              { type: 'text', text: `Extract everything you can read from this image${fileName ? ` (uploaded as "${fileName}" — do not use the filename to infer document type, only what's visibly on the image)` : ''}.` },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    console.error('extract-document-vision: network error calling Anthropic', err);
    return jsonResponse({ error: 'Could not reach the vision model provider.' }, 502);
  }

  if (!anthropicRes.ok) {
    // Anthropic error bodies can include account/billing detail — logged server-side only, never
    // relayed to the browser.
    const errText = await anthropicRes.text().catch(() => '');
    console.error(`extract-document-vision: Anthropic API returned ${anthropicRes.status}`, errText.slice(0, 2000));
    return jsonResponse({ error: 'The vision model provider returned an error.' }, 502);
  }

  const data = await anthropicRes.json();
  const toolUse = Array.isArray(data?.content) ? data.content.find((block: { type?: string }) => block?.type === 'tool_use') : null;
  if (!toolUse?.input) {
    console.error('extract-document-vision: no tool_use block in Anthropic response');
    return jsonResponse({ error: 'The vision model did not return structured data.' }, 502);
  }

  return jsonResponse(toolUse.input, 200);
});
