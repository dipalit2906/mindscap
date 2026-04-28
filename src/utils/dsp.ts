import { Buffer } from 'buffer';

/**
 * Converts a Base64 encoded PCM16 bit string to a Float32Array
 * Normalized to the range [-1.0, 1.0]
 */
export const base64ToFloat32 = (base64: string): Float32Array => {
  const pcmData = Buffer.from(base64, 'base64');
  const samples = new Float32Array(pcmData.length / 2);
  
  for (let i = 0; i < samples.length; i++) {
    // Read 16-bit signed integer (Little Endian)
    const s16 = pcmData.readInt16LE(i * 2);
    // Normalize to [-1.0, 1.0]
    samples[i] = s16 / 32768.0;
  }
  
  return samples;
};

/**
 * Calculates the Root Mean Square (Volume) of a buffer
 */
export const calculateRMS = (samples: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
};

/**
 * Calculates the Zero Crossing Rate (Sharpness/Noise)
 * Real breathing has low ZCR (0.05 - 0.4), Static noise has high ZCR (> 0.7)
 */
export const calculateZCR = (samples: Float32Array): number => {
  let count = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
      count++;
    }
  }
  return count / samples.length;
};

/**
 * Estimates the Spectral Centroid (Center Frequency)
 * Used to distinguish between low-frequency breath and high-frequency background noise
 */
export const calculateCentroid = (samples: Float32Array, sampleRate: number = 16000): number => {
  let weightedSum = 0;
  let totalAmplitude = 0;
  
  for (let i = 0; i < samples.length; i++) {
    const amplitude = Math.abs(samples[i]);
    weightedSum += i * amplitude;
    totalAmplitude += amplitude;
  }
  
  if (totalAmplitude === 0) return 0;
  
  const meanIndex = weightedSum / totalAmplitude;
  return (meanIndex * sampleRate) / samples.length;
};
