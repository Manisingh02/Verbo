import { GoogleAuth } from 'google-auth-library';

const TRANSLATION_MODEL = 'google-cloud-translation-v3' as const;
const DEFAULT_TRANSLATION_LOCATION = 'global';

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

function normalizeLanguageCode(value: string | undefined, fallback: string): string {
  const normalized = (value || fallback).trim().toLowerCase();
  return normalized || fallback;
}

function getTranslationConfig() {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_CONFIG_PROJECT_ID ||
    '';
  const location = normalizeLanguageCode(
    process.env.GOOGLE_CLOUD_TRANSLATION_LOCATION,
    DEFAULT_TRANSLATION_LOCATION
  );

  if (!projectId) {
    throw new Error('Missing GOOGLE_CLOUD_PROJECT for Cloud Translation requests.');
  }

  return { projectId, location };
}

export async function translateTexts(params: {
  texts: string[];
  sourceLanguage?: string;
  targetLanguage?: string;
}): Promise<{
  sourceLanguage: string;
  targetLanguage: string;
  translatedTexts: string[];
  model: typeof TRANSLATION_MODEL;
}> {
  const texts = params.texts.map((text) => text.trim()).filter(Boolean);
  const sourceLanguage = normalizeLanguageCode(params.sourceLanguage, 'en');
  const targetLanguage = normalizeLanguageCode(params.targetLanguage, 'es');

  if (texts.length === 0) {
    return {
      sourceLanguage,
      targetLanguage,
      translatedTexts: [],
      model: TRANSLATION_MODEL,
    };
  }

  const { projectId, location } = getTranslationConfig();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token =
    typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token || '';

  if (!token) {
    throw new Error('Unable to acquire Google Cloud access token for translation.');
  }

  const endpoint =
    `https://translation.googleapis.com/v3/projects/${projectId}` +
    `/locations/${location}:translateText`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: texts,
      mimeType: 'text/plain',
      sourceLanguageCode: sourceLanguage,
      targetLanguageCode: targetLanguage,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Translation request failed with ${response.status}: ${text}`);
  }

  const payload = (await response.json()) as {
    translations?: Array<{ translatedText?: string }>;
  };

  return {
    sourceLanguage,
    targetLanguage,
    translatedTexts: (payload.translations || []).map((item) => item.translatedText || ''),
    model: TRANSLATION_MODEL,
  };
}

