import { useState, useCallback, useRef } from 'react';

export enum BreathingState {
  NARROWED = 'Narrowed',
  TRANSITION = 'Transition',
  EXPANDED = 'Expanded',
  STABILISED = 'Stabilised',
}

interface BreathingMetrics {
  bpm: number;
  variance: number;
  ieRatio: number;
  depth: number;
}

const BPM_WINDOW_MS = 30000; 

export const useBreathingEngine = () => {
  const [state, setState] = useState<BreathingState>(BreathingState.TRANSITION);
  const [metrics, setMetrics] = useState<BreathingMetrics>({ bpm: 0, variance: 0, ieRatio: 1, depth: 0 });
  
  const cycleTimestamps = useRef<number[]>([]);
  const cycleDurations = useRef<number[]>([]);
  const lastInhaleDuration = useRef<number>(0);
  const lastDepth = useRef<number>(0);

  const calculateMetrics = useCallback(() => {
    const now = Date.now();
    cycleTimestamps.current = cycleTimestamps.current.filter(t => now - t < BPM_WINDOW_MS);
    const bpm = (cycleTimestamps.current.length / (BPM_WINDOW_MS / 60000));
    const variance = calculateStdDev(cycleDurations.current.slice(-6)); 
    return { bpm, variance };
  }, []);

  const calculateStdDev = (values: number[]) => {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(v => Math.pow(v - mean, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquareDiff) / 1000; 
  };

  const onBreathEvent = useCallback((type: 'Inhale' | 'Exhale' | 'Silence', duration: number, depth: number) => {
    const now = Date.now();
    
    if (type === 'Silence') {
      cycleTimestamps.current = [];
      cycleDurations.current = [];
      setMetrics({ bpm: 0, variance: 0, ieRatio: 1, depth: 0 });
      setState(BreathingState.TRANSITION);
      return;
    }

    if (type === 'Inhale') {
      lastInhaleDuration.current = duration;
      lastDepth.current = depth;
    } else if (type === 'Exhale') {
      const cycleDuration = lastInhaleDuration.current + duration;
      cycleTimestamps.current.push(now);
      cycleDurations.current.push(cycleDuration);
      if (cycleDurations.current.length > 20) cycleDurations.current.shift();

      const { bpm, variance } = calculateMetrics();
      const ieRatio = duration > 0 ? lastInhaleDuration.current / duration : 1;
      
      setMetrics({ bpm, variance, ieRatio, depth: lastDepth.current });

      let nextState = state;
      
      if (bpm <= 8 && variance < 1.5) {
        nextState = BreathingState.STABILISED;
      }
      else if (bpm <= 13 && variance < 2.0) {
        nextState = BreathingState.EXPANDED;
      }
      else if (bpm > 18 || variance > 3.5) {
        nextState = BreathingState.NARROWED;
      }
      else {
        nextState = BreathingState.TRANSITION;
      }

      // --- RESTORED LOGS ---
      console.log(`[ENGINE] Stats -> BPM: ${bpm.toFixed(1)} | Var: ${variance.toFixed(2)}s | IE: ${ieRatio.toFixed(2)}`);
      if (nextState !== state) {
        console.log(`[ENGINE] STATE CHANGE: ${state} -> ${nextState}`);
      }

      const states = [BreathingState.NARROWED, BreathingState.TRANSITION, BreathingState.EXPANDED, BreathingState.STABILISED];
      const currentIndex = states.indexOf(state);
      const nextIndex = states.indexOf(nextState);
      
      if (Math.abs(nextIndex - currentIndex) <= 1) {
        setState(nextState);
      } else {
        const direction = nextIndex > currentIndex ? 1 : -1;
        setState(states[currentIndex + direction]);
      }
    }
  }, [calculateMetrics, state]);

  return { state, metrics, onBreathEvent };
};
