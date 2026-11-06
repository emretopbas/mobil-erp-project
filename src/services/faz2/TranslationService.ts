// Faz 2 seam (CLAUDE.md §1: "Çeviri katmanı (metin çeviri + ses
// klonlama/dublaj)"). No Faz 1 caller needs this at all — it exists purely
// so the interface shape is settled ahead of time, per §1's own rule that
// nothing built in Faz 1 should need refactoring when Faz 2 lands.

export interface TranslationService {
  translateText(text: string, targetLanguage: string): Promise<string>;
  /** Voice cloning/dubbing — further out than text translation; signature
   * is deliberately loose (an audio URI in, an audio URI out) since Faz 2
   * will pick the actual provider. */
  dubAudio(audioUri: string, targetLanguage: string): Promise<string>;
}

class TranslationServiceImpl implements TranslationService {
  translateText(): Promise<string> {
    throw new Error('NotImplemented: TranslationService is a Faz 2 feature — CLAUDE.md §1.');
  }
  dubAudio(): Promise<string> {
    throw new Error('NotImplemented: TranslationService is a Faz 2 feature — CLAUDE.md §1.');
  }
}

export const translationService: TranslationService = new TranslationServiceImpl();
