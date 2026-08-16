/**
 * Pure JavaScript 16-bit PCM Stereo WAV Encoder
 */
class WavEncoder {
  static createHeader(sampleRate, numChannels, frameCount) {
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = frameCount * blockAlign;
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    return buffer;
  }

  static floatChannelsToInterleavedPcm16(left, right = left) {
    const output = new Int16Array(left.length * 2);

    for (let i = 0; i < left.length; i++) {
      const leftSample = Math.max(-1, Math.min(1, left[i]));
      const rightSample = Math.max(-1, Math.min(1, right[i]));
      output[i * 2] = leftSample < 0 ? leftSample * 0x8000 : leftSample * 0x7FFF;
      output[(i * 2) + 1] = rightSample < 0 ? rightSample * 0x8000 : rightSample * 0x7FFF;
    }

    return output;
  }

  static encodePcm16Chunks(chunks, sampleRate, numChannels, frameCount) {
    const samplesRequired = frameCount * numChannels;
    const parts = [this.createHeader(sampleRate, numChannels, frameCount)];
    let samplesAdded = 0;

    for (const chunk of chunks) {
      if (samplesAdded >= samplesRequired) break;
      const remaining = samplesRequired - samplesAdded;
      const selected = remaining < chunk.length ? chunk.subarray(0, remaining) : chunk;
      parts.push(selected);
      samplesAdded += selected.length;
    }

    if (samplesAdded !== samplesRequired) {
      throw new Error('PCM chunk data is shorter than the declared WAV frame count');
    }

    return new Blob(parts, { type: 'audio/wav' });
  }

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
    const pcm = numChannels === 2
      ? this.floatChannelsToInterleavedPcm16(left, right)
      : Int16Array.from(left, (sample) => {
        const clamped = Math.max(-1, Math.min(1, sample));
        return clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
      });
    return this.encodePcm16Chunks([pcm], sampleRate, numChannels, length);
  }

  /**
   * Helper to write ASCII strings to DataView
   */
  static writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

}

export default WavEncoder;
export { WavEncoder };
