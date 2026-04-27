import { useState, useCallback, useRef } from 'react';

export type BreathPhase = 'Inhale' | 'Exhale' | 'Silence';

interface DetectorProps {
  onPhaseChange?: (phase: BreathPhase, durationMs: number, depth: number) => void;
  noiseFloor?: number;
}

export const useInhaleExhaleDetector = ({
  onPhaseChange,
  noiseFloor = 0.003,
}: DetectorProps = {}) => {
  const phaseRef = useRef<BreathPhase>('Silence');
  const [currentPhase, setCurrentPhase] = useState<BreathPhase>('Silence');
  
  const phaseStartTime = useRef<number>(Date.now());
  const peakRms = useRef<number>(0);
  const rmsBuffer = useRef<number[]>([]);
  const lastActivityTime = useRef<number>(Date.now());
  const hasResetSent = useRef<boolean>(false);
  
  const floorBuffer = useRef<number[]>([]);
  const adaptiveFloor = useRef(noiseFloor);
  const startTime = useRef<number>(Date.now());
  const isCalibrated = useRef<boolean>(false);
  
  // Learning your specific mic gain and lung power
  const adaptivePeak = useRef<number>(0.10); 

  const MIN_PHASE_MS = 250; 
  const SILENCE_CONFIRM_MS = 900;

  const processFrame = useCallback((rms: number, zcr: number, centroid: number) => {
    const now = Date.now();
    const elapsed = now - startTime.current;

    // 1. AUTO-CALIBRATION (3s window)
    if (!isCalibrated.current) {
      if (elapsed < 3000) {
        floorBuffer.current = [...floorBuffer.current.slice(-60), rms];
        const avg = floorBuffer.current.reduce((a, b) => a + b, 0) / Math.max(floorBuffer.current.length, 1);
        adaptiveFloor.current = Math.max(avg * 1.5, 0.003);
        if (elapsed % 1000 < 100) console.log(`[MIC] Calibrating Room... Baseline: ${adaptiveFloor.current.toFixed(4)}`);
        return;
      } else {
        console.log(`[MIC] READY. Floor: ${adaptiveFloor.current.toFixed(4)}`);
        isCalibrated.current = true;
        lastActivityTime.current = now;
      }
    }

    // 2. Continuous Floor Adjust (Silence only)
    if (phaseRef.current === 'Silence') {
      floorBuffer.current = [...floorBuffer.current.slice(-100), rms];
      const minSeen = Math.min(...floorBuffer.current);
      adaptiveFloor.current = (adaptiveFloor.current * 0.995) + (Math.max(minSeen * 1.8, 0.003) * 0.005);
    }

    // 3. Smoothing
    rmsBuffer.current = [...rmsBuffer.current.slice(-5), rms];
    const smoothRMS = rmsBuffer.current.reduce((a, b) => a + b, 0) / rmsBuffer.current.length;

    // 4. Schmitt Trigger Logic
    const entryThreshold = adaptiveFloor.current * 1.30; 
    const exitThreshold = adaptiveFloor.current * 0.65;  
    
    let targetPhase: BreathPhase;
    
    // Tolerant ZCR for mouth breathing/noise
    const isAboveEntry = smoothRMS > entryThreshold && zcr < 0.85;
    const isAboveExit = smoothRMS > exitThreshold && zcr < 0.90;

    if (phaseRef.current === 'Silence') {
      targetPhase = isAboveEntry ? 'Inhale' : 'Silence';
    } else {
      if (!isAboveExit) {
        targetPhase = 'Silence';
      } else {
        const prevSmooth = rmsBuffer.current.length > 1
          ? rmsBuffer.current.slice(-5, -1).reduce((a, b) => a + b, 0) / Math.max(rmsBuffer.current.length - 1, 1)
          : smoothRMS;

        if (phaseRef.current === 'Inhale') {
          // If volume drops 12% or is clearly falling, it's an exhale
          targetPhase = (smoothRMS < peakRms.current * 0.88 || smoothRMS < prevSmooth * 0.97) ? 'Exhale' : 'Inhale';
        } else {
          // If volume jumps 25%, it's a new inhale
          targetPhase = (smoothRMS > prevSmooth * 1.25) ? 'Inhale' : 'Exhale';
        }
      }
    }

    const timeInPhase = now - phaseStartTime.current;

    // 5. STABLE TRANSITION
    let shouldSwitch = false;
    if (targetPhase !== phaseRef.current) {
      shouldSwitch = targetPhase === 'Silence' ? timeInPhase > SILENCE_CONFIRM_MS : timeInPhase > MIN_PHASE_MS;
    }

    if (shouldSwitch) {
      const duration = timeInPhase;
      
      // Update Adaptive Peak (Learn the user's lung power)
      if (phaseRef.current === 'Inhale') {
         adaptivePeak.current = (adaptivePeak.current * 0.8) + (peakRms.current * 0.2);
         // Safety bounds for adaptive peak
         adaptivePeak.current = Math.max(Math.min(adaptivePeak.current, 0.3), 0.05);
      }
      
      const calculatedDepth = Math.min(peakRms.current / adaptivePeak.current, 1.0);

      if (targetPhase === 'Inhale' && phaseRef.current !== 'Inhale') {
        console.log(`[DETECTOR] >>> INHALE START`);
      } else if (targetPhase === 'Exhale' && phaseRef.current !== 'Exhale') {
        console.log(`[DETECTOR] <<< EXHALE START | Depth: ${(calculatedDepth * 100).toFixed(0)}% (Range: ${adaptivePeak.current.toFixed(3)})`);
      } else if (targetPhase === 'Silence' && phaseRef.current !== 'Silence') {
        console.log(`[DETECTOR] --- SILENCE ---`);
      }

      phaseRef.current = targetPhase;
      setCurrentPhase(targetPhase);
      onPhaseChange?.(targetPhase, duration, calculatedDepth);
      phaseStartTime.current = now;
      
      if (targetPhase === 'Inhale') {
        peakRms.current = rms;
        lastActivityTime.current = now;
        hasResetSent.current = false;
      }
    } else if (targetPhase === 'Inhale') {
      peakRms.current = Math.max(peakRms.current, rms);
      lastActivityTime.current = now;
      hasResetSent.current = false;
    } else if (targetPhase === 'Exhale') {
      lastActivityTime.current = now;
      hasResetSent.current = false;
    }

    // 6. 10s RESET
    if (now - lastActivityTime.current > 10000 && !hasResetSent.current) {
       console.log('[DETECTOR] Inactivity Reset');
       hasResetSent.current = true;
       onPhaseChange?.('Silence', 0, 0);
    }
  }, [onPhaseChange]);

  return { currentPhase, processFrame, isCalibrating: !isCalibrated.current, depth: Math.min(peakRms.current / adaptivePeak.current, 1.0) };
};
