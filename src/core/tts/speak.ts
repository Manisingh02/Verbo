import * as Speech from 'expo-speech';

export function speakLetter(letter: string, nativeIso: 'en' | 'es') {
  Speech.stop();
  const language = nativeIso === 'es' ? 'es-ES' : 'en-US';
  const phrase = nativeIso === 'es' ? `la letra ${letter}` : `the letter ${letter}`;
  Speech.speak(phrase, {
    language,
    rate: nativeIso === 'es' ? 0.72 : 0.78,
    pitch: 1.0,
  });
}
