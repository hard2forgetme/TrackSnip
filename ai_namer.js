/**
 * AI Namer Module - Translates Raw Generation Prompts & Messy Web Titles into
 * Clean, Punchy, Aesthetic Song Titles.
 * Supports Local Ollama / LM Studio APIs with built-in instant fallback heuristics.
 */

import {
  DEFAULT_LOCAL_AI_ENDPOINT,
  normalizeLocalAiEndpoint
} from './local_endpoint_policy.js';

class AINamer {
  /**
   * Generates an aesthetic song title from a raw prompt or metadata string
   * @param {string} rawPrompt - The raw prompt or track text
   * @param {Object} options - AI configuration
   * @returns {Promise<string>} Clean, aesthetic song title
   */
  static async generateTitle(rawPrompt, options = {}) {
    if (!rawPrompt || typeof rawPrompt !== 'string') {
      return 'Untitled Track';
    }

    const preCleaned = this.preCleanInput(rawPrompt);
    if (!preCleaned || preCleaned.length === 0) {
      return 'Untitled Track';
    }

    const enabled = options.enabled !== false;
    if (!enabled) {
      return this.cleanHeuristicTitle(preCleaned);
    }

    const provider = options.provider || 'ollama';
    const endpoint = normalizeLocalAiEndpoint(options.endpoint || DEFAULT_LOCAL_AI_ENDPOINT);
    const model = options.model || 'qwen2.5:0.5b';

    if (provider === 'heuristic') {
      return this.cleanHeuristicTitle(preCleaned);
    }

    try {
      if (provider === 'ollama') {
        const title = await this.queryOllama(preCleaned, endpoint, model);
        if (title && title.length > 0) {
          return this.sanitizeOutputTitle(title);
        }
      } else if (provider === 'openai-compatible') {
        const title = await this.queryOpenAICompatible(preCleaned, endpoint, model);
        if (title && title.length > 0) {
          return this.sanitizeOutputTitle(title);
        }
      }
    } catch (err) {
      console.warn('AI Naming query failed, falling back to smart heuristic:', err.message);
    }

    return this.cleanHeuristicTitle(preCleaned);
  }

  /**
   * Pre-cleans platform prefixes, file extensions, and audio tags
   */
  static preCleanInput(text) {
    let s = text.replace(/\s+/g, ' ').trim();

    // Strip platform brand headers: "Suno - ", "Udio | ", "YouTube - ", "SoundCloud: "
    s = s.replace(/^(suno|udio|youtube\s*music|youtube|soundcloud|spotify|apple\s*music|bandcamp|musicfx)\s*[-:|•_~]\s*/i, '');

    // Strip file extensions
    s = s.replace(/\.(wav|mp3|m4a|ogg|flac|aac|weba|webm)$/i, '');

    // Strip common audio export suffixes: "- Audio_short 3", "_audio_short", "- Master 1", etc.
    s = s.replace(/[-_]?(audio|short|clip|snippet|render|track|master|vocal|inst|stem)[-_0-9\s]*$/i, '');

    // Normalize underscores around words to spaces if not formatting
    s = s.replace(/_([a-zA-Z0-9\s]+)_/g, ' $1 ');
    s = s.replace(/_/g, ' ');

    return s.replace(/\s+/g, ' ').trim();
  }

  /**
   * Cleans a trusted player-provided title without replacing it with an invented name.
   */
  static cleanMetadataTitle(rawTitle) {
    if (!rawTitle) return 'Untitled Track';

    let clean = String(rawTitle)
      .replace(/\.(wav|mp3|m4a|ogg|flac|aac|weba|webm)$/i, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const trailingExportLabel = /\s*(?:[-–—|]\s*)?(?:audio|short|clip|snippet|render|track|master|vocal|instrumental|inst|stem|extend)(?:\s+\d+)*\s*$/i;
    let previous;
    do {
      previous = clean;
      clean = clean.replace(trailingExportLabel, '').trim();
    } while (clean && clean !== previous);

    clean = clean
      .replace(/^(suno|udio|youtube\s*music|youtube|soundcloud|spotify|apple\s*music|bandcamp|musicfx)\s*[-:|]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    return this.toTitleCase(clean) || 'Untitled Track';
  }

  /**
   * Queries Ollama /api/generate endpoint
   */
  static async queryOllama(promptText, endpoint, model) {
    endpoint = normalizeLocalAiEndpoint(endpoint);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const systemPrompt = `You create distinctive music track titles from descriptive prompts.

Rules:
1. If the input contains an explicit song name, preserve that name.
2. Otherwise invent a specific 2 to 3 word title grounded in the input's unusual imagery or subject.
3. Avoid generic synthwave filler such as neon, pulse, echo, drift, midnight, dream, horizon, and electric unless the input explicitly requires that word.
4. Do not reuse a stock title across unrelated prompts.
5. Output only the title with no quotation marks, punctuation, reasoning, or explanation.`;

    const fullPrompt = `${systemPrompt}\n\nInput: ${promptText}\nTitle:`;

    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: fullPrompt,
        stream: false,
        options: {
          temperature: 0.5,
          num_predict: 120
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.response ? data.response.trim() : '';
  }

  /**
   * Queries OpenAI-compatible /v1/chat/completions endpoint
   */
  static async queryOpenAICompatible(promptText, endpoint, model) {
    endpoint = normalizeLocalAiEndpoint(endpoint);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert music track title generator. If a specific title is quoted or underscored, extract it. If it is a descriptive generation prompt, do NOT copy words verbatim; synthesize a creative 2 to 3 word poetic song title. Output ONLY the title with no quotes.'
          },
          {
            role: 'user',
            content: `Synthesize clean aesthetic song title for: ${promptText}`
          }
        ],
        max_tokens: 120,
        temperature: 0.5
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`OpenAI Compatible HTTP ${res.status}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    return content ? content.trim() : '';
  }

  /**
   * Fetches list of locally installed models from Ollama
   */
  static async fetchOllamaModels(endpoint = DEFAULT_LOCAL_AI_ENDPOINT) {
    endpoint = normalizeLocalAiEndpoint(endpoint);
    try {
      const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/tags`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.models)) {
          return data.models.map(m => m.name || m.model);
        }
      }
    } catch (e) {}
    return [];
  }

  /**
   * Pulls/downloads a model into Ollama with streaming progress updates,
   * robust line buffering for fragmented chunks, and explicit error handling.
   */
  static async pullOllamaModel(modelName, endpoint = DEFAULT_LOCAL_AI_ENDPOINT, onProgress = null) {
    if (!modelName) throw new Error('Model name is required');
    endpoint = normalizeLocalAiEndpoint(endpoint);

    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName.trim(), stream: true })
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Ollama Pull Error HTTP ${res.status}: ${errorText || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let lastStatus = 'Downloading...';
    let lineBuffer = '';
    let isSuccess = false;
    let streamError = null;

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      if (value) {
        lineBuffer += decoder.decode(value, { stream: !doneReading });
        const lines = lineBuffer.split('\n');
        // Keep the last partial line in the buffer
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed);

            if (data.error) {
              streamError = data.error;
              throw new Error(data.error);
            }

            if (data.status === 'success') {
              isSuccess = true;
            }

            lastStatus = data.status || lastStatus;
            let percent = 0;
            if (data.total && data.completed) {
              percent = Math.min(100, Math.round((data.completed / data.total) * 100));
            } else if (isSuccess) {
              percent = 100;
            }

            if (onProgress) {
              onProgress({
                status: lastStatus,
                completed: data.completed || 0,
                total: data.total || 0,
                percent: percent
              });
            }
          } catch (err) {
            if (streamError) throw err;
            // JSON parse error on malformed line - continue if not fatal
          }
        }
      }
    }

    // Process any remaining bytes in lineBuffer
    if (lineBuffer.trim()) {
      try {
        const data = JSON.parse(lineBuffer.trim());
        if (data.error) throw new Error(data.error);
        if (data.status === 'success') isSuccess = true;
      } catch (e) {
        if (streamError) throw new Error(streamError);
      }
    }

    if (streamError) {
      throw new Error(`Ollama pull failed: ${streamError}`);
    }

    if (!isSuccess) {
      throw new Error(`Ollama pull stream closed without success confirmation (last status: ${lastStatus})`);
    }

    return { success: true, model: modelName };
  }

  /**
   * Cleans and sanitizes output from LLMs
   */
  static sanitizeOutputTitle(title) {
    if (!title) return 'Untitled Track';

    let clean = title;

    // If model outputs thinking ending with </think>, take everything after </think>
    if (clean.includes('</think>')) {
      clean = clean.split('</think>').pop().trim();
    }

    // Strip any remaining <think> tags
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Strip quotes, prefix labels, platform words, and newlines
    clean = clean
      .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
      .replace(/^(title|song title|track title|name):\s*/i, '')
      .replace(/^(suno|udio|youtube|soundcloud)\s*[-:|•]\s*/i, '')
      .replace(/[\n\r]+/g, ' ')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();

    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      clean = lines[lines.length - 1];
    }

    clean = this.toTitleCase(clean);

    if (clean.length > 60) {
      clean = clean.substring(0, 60).trim();
    }

    return clean || 'Untitled Track';
  }

  /**
   * High-accuracy rule-based NLP title extractor
   */
  static cleanHeuristicTitle(rawPrompt) {
    if (!rawPrompt) return 'Untitled Track';

    let text = this.preCleanInput(rawPrompt);

    // If explicit song title in quotes or between dashes
    const quotedMatch = text.match(/["'“]([^"'“”]+)["'”]/);
    if (quotedMatch && quotedMatch[1].trim().length > 1) {
      return this.toTitleCase(quotedMatch[1].trim());
    }

    // Check for "song called X", "song named X", "track X", "song X"
    const songNameMatch = text.match(/\b(?:song|track|clip of the (?:hit )?(?:alien|rock|pop|rap|synth)?\s*song)\s+(?:called|named)?\s*([A-Za-z0-9\s]{2,30}?)(?:\s*[-–—|•]|\s*\(|\s*$)/i);
    if (songNameMatch && songNameMatch[1].trim().length > 1) {
      return this.toTitleCase(songNameMatch[1].trim());
    }

    // Remove boilerplate descriptors
    text = text.replace(/--[a-z0-9_-]+(\s+[0-9.:]+)?/gi, '');
    text = text.replace(/\[(?:intro|verse|chorus|bridge|outro|drop|solo|vocals)\]/gi, '');
    text = text.replace(/\b\d+\s*bpm\b/gi, '');
    text = text.replace(/\b(?:key of [a-g][#b]?\s*(?:major|minor)?)\b/gi, '');
    text = text.replace(/\b(?:masterpiece|high quality|320kbps|studio quality|lossless|best quality)\b/gi, '');
    text = text.replace(/\b(?:instrumental|soundtrack|background music|no vocals)\b/gi, '');
    text = text.replace(/\b(?:a clip of|the hit song|official audio|official video)\b/gi, '');

    const aboutMatch = text.match(/\babout\s+([^,.;]+)/i);
    if (aboutMatch && aboutMatch[1].trim().length > 3) {
      text = aboutMatch[1].trim();
    } else {
      const parts = text.split(/[,;|•\n-]+/).map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length > 0) {
        let bestPart = parts[0];
        for (const p of parts) {
          if (p.split(/\s+/).length >= 2 && p.split(/\s+/).length <= 5) {
            bestPart = p;
            break;
          }
        }
        text = bestPart;
      }
    }

    text = text.replace(/\b(?:with|featuring|feat|ft\.?|synth|bass|drums|vocals|guitar|piano|heavy|dark|energetic|chill|lofi|80s|90s)\b/gi, ' ');
    text = text.replace(/\s+/g, ' ').trim();

    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 4) {
      text = words.slice(0, 4).join(' ');
    }

    text = this.toTitleCase(text);
    return text || 'Aesthetic Track';
  }

  /**
   * Title Case helper
   */
  static toTitleCase(str) {
    const smallWords = /^(a|an|and|as|at|but|by|for|if|in|nor|of|on|or|so|the|to|via)$/i;
    return str
      .toLowerCase()
      .split(' ')
      .filter(Boolean)
      .map((word, index, arr) => {
        if (index > 0 && index < arr.length - 1 && smallWords.test(word)) {
          return word.toLowerCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.AINamer = AINamer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AINamer;
}

export default AINamer;
export { AINamer };
