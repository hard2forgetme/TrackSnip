/**
 * Pure JavaScript 16-bit PCM Stereo WAV Encoder
 */
class WavEncoder {
  /**
   * Encodes stereo Float32Array PCM channels to a WAV Blob.
   * @param {Float32Array[]} channels - Array containing [leftChannel, rightChannel]
   * @param {number} sampleRate - Audio sample rate (e.g. 44100 or 48000)
   * @returns {Blob} WAV Blob
   */
  static encode(channels, sampleRate = 44100) {
    const left = channels[0];
    const right = channels[1] || channels[0]; // fallback to mono cloned if single channel
    const numChannels = channels.length >= 2 ? 2 : 1;
    const length = left.length;

    // 16-bit samples = 2 bytes per sample
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF identifier 'RIFF'
    this.writeString(view, 0, 'RIFF');
    // File length minus 8 bytes (RIFF identifier + length field)
    view.setUint32(4, 36 + dataSize, true);
    // 'WAVE'
    this.writeString(view, 8, 'WAVE');
    // 'fmt ' chunk
    this.writeString(view, 12, 'fmt ');
    // Subchunk1Size (16 for PCM)
    view.setUint32(16, 16, true);
    // AudioFormat (1 = PCM)
    view.setUint16(20, 1, true);
    // NumChannels
    view.setUint16(22, numChannels, true);
    // SampleRate
    view.setUint32(24, sampleRate, true);
    // ByteRate
    view.setUint32(28, byteRate, true);
    // BlockAlign
    view.setUint16(32, blockAlign, true);
    // BitsPerSample (16 bits)
    view.setUint16(34, 16, true);
    // 'data' chunk header
    this.writeString(view, 36, 'data');
    // Subchunk2Size (data size)
    view.setUint32(40, dataSize, true);

    // Write PCM samples (interleaved for stereo)
    let offset = 44;
    for (let i = 0; i < length; i++) {
      // Left channel sample
      let sLeft = Math.max(-1, Math.min(1, left[i]));
      view.setInt16(offset, sLeft < 0 ? sLeft * 0x8000 : sLeft * 0x7FFF, true);
      offset += 2;

      if (numChannels === 2) {
        // Right channel sample
        let sRight = Math.max(-1, Math.min(1, right[i]));
        view.setInt16(offset, sRight < 0 ? sRight * 0x8000 : sRight * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * Helper to write ASCII strings to DataView
   */
  static writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * Converts Blob to base64 Data URL
   * @param {Blob} blob 
   * @returns {Promise<string>}
   */
  static blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export default WavEncoder;
export { WavEncoder };
