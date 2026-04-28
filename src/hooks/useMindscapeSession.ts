import { useState, useCallback, useRef, useEffect } from 'react';
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { Asset } from 'expo-asset';
import { useSharedValue, withTiming } from 'react-native-reanimated';

export enum MindscapeState {
  NARROWED = 'Narrowed',
  TRANSITION = 'Transition',
  EXPANDED = 'Expanded',
  STABILISED = 'Stabilised',
}

export type BreathPhase = 'Inhale' | 'Exhale' | 'Silence';

export interface MindscapeMetrics {
  bpm: number;
  variance: number;
  ieRatio: number;
  depth: number;
}

const BPM_WINDOW_MS = 30000;
const VAR_WINDOW_MS = 60000;

export const useMindscapeSession = (isCalibration: boolean = false) => {
  const [state, setState] = useState<MindscapeState>(MindscapeState.TRANSITION);
  const [metrics, setMetrics] = useState<MindscapeMetrics>({ bpm: 0, variance: 0, ieRatio: 1, depth: 0 });
  const [currentPhase, setCurrentPhase] = useState<BreathPhase>('Silence');
  const phaseRef = useRef<BreathPhase>('Silence');

  // Sync ref with state for use in callbacks
  useEffect(() => { phaseRef.current = currentPhase; }, [currentPhase]);

  // TFLite Model Loading
  const [model, setModel] = useState<TensorflowModel | null>(null);

  useEffect(() => {
    async function loadModel() {
      try {
        const asset = Asset.fromModule(require('../../assets/breath_model1.tflite'));
        await asset.downloadAsync();
        if (asset.localUri) {
          const m = await loadTensorflowModel({ url: asset.localUri }, []);
          setModel(m);
          console.log('[TFLITE] Model loaded from:', asset.localUri);
          console.log('[TFLITE] Model Inputs:', JSON.stringify(m.inputs));
          console.log('[TFLITE] Model Outputs:', JSON.stringify(m.outputs));
        }
      } catch (err) {
        console.error('[TFLITE] Failed to load model:', err);
      }
    }
    loadModel();
  }, []);

  // Metrics tracking
  const cycleTimestamps = useRef<number[]>([]);
  const cycleDurations = useRef<number[]>([]);
  const lastPhaseStartTime = useRef<number>(Date.now());
  const lastInhaleDuration = useRef<number>(0);
  const accumulatedInhaleTime = useRef<number>(0);
  const adaptiveFloor = useRef<number>(0.005);
  const coreNoiseFloor = useRef<number>(0.20);
  const detailNoiseFloor = useRef<number>(0.30);
  const floorBuffer = useRef<number[]>([]);
  const peakRms = useRef<number>(0);
  const smoothedRms = useRef<number>(0);
  const dropCounter = useRef<number>(0);

  // State Stability (Hold Durations)
  const stateStartTime = useRef<number>(Date.now());
  const targetState = useRef<MindscapeState>(MindscapeState.TRANSITION);

  // Awareness Moment
  const sessionStartTime = useRef<number>(Date.now());
  const hasTriggeredAwareness = useRef<boolean>(false);
  const [isAwarenessMoment, setIsAwarenessMoment] = useState(false);
  const isReadyLogSent = useRef(false);

  // AI inference state
  const isInferenceRunning = useRef(false);
  const lastInferenceTime = useRef<number>(0);
  const confidenceRef = useRef<number>(0);
  const topIndexRef = useRef<number>(-1);
  const dynamicAiThresholdRef = useRef<number>(0.25);
  const detailThresholdRef = useRef<number>(0.40);
  const aiBuffer = useRef<number>(0);

  const calculateMetrics = useCallback(() => {
    if (cycleDurations.current.length === 0) return { bpm: 0, variance: 0 };

    // Smooth BPM (average of last 3 cycles for stability)
    const recentCycles = cycleDurations.current.slice(-3);
    const avgCycle = recentCycles.reduce((a, b) => a + b, 0) / recentCycles.length;
    const bpm = 60000 / avgCycle;

    // Variance (Std Dev) over last 6 cycles (longer window for stability)
    let variance = 0;
    const varCycles = cycleDurations.current.slice(-6);
    if (varCycles.length > 1) {
      const mean = varCycles.reduce((a, b) => a + b, 0) / varCycles.length;
      const squareDiffs = varCycles.map(v => Math.pow(v - mean, 2));
      const rawVariance = Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / varCycles.length) / 1000;
      // Smooth the variance itself to prevent spikes
      variance = (variance * 0.5) + (rawVariance * 0.5);
    }

    return { bpm, variance };
  }, []);
  const updateState = useCallback((bpm: number, variance: number, ieRatio: number) => {
    let next: MindscapeState = MindscapeState.TRANSITION; // Default to Transition if criteria not met

    // RELAXED CRITERIA FOR PEAK STATES
    if (bpm < 6) {
      // STABILISED: High performance calm (Relaxed variance requirement)
      next = (variance < 1.5) ? MindscapeState.STABILISED : MindscapeState.EXPANDED;
    } else if (bpm < 10) {
      // EXPANDED: Good calm breathing
      next = MindscapeState.EXPANDED;
    } else if (bpm <= 15) {
      // TRANSITION: Normal/Entering calm
      next = MindscapeState.TRANSITION;
    } else {
      // NARROWED: Fast/Stressed breathing
      next = MindscapeState.NARROWED;
    }

    if (next !== targetState.current) {
      console.log(`[ENGINE] Target State -> ${next} (Holding for stability...)`);
      targetState.current = next;
      stateStartTime.current = Date.now();
    }
  }, [state]);

  // STALE DATA CLEANUP (BPM Decay)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastPhaseStartTime.current > 40000 && metrics.bpm > 0) {
        console.log('[ENGINE] ! STALE DATA: No breath for 40s. Resetting metrics.');
        setMetrics({ bpm: 0, variance: 0, ieRatio: 1, depth: 0 });
        targetState.current = MindscapeState.TRANSITION;
        stateStartTime.current = now;
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [metrics.bpm]);

  const handleInference = useCallback(async (rms: number, zcr: number, centroid: number, waveform?: Float32Array) => {
    // 0. NATURAL SIGNAL TRACKING
    smoothedRms.current = (smoothedRms.current * 0.8) + (rms * 0.2);
    const sRms = smoothedRms.current;

    // MIC CHECK removed for production cleanliness

    if (isCalibration) {
      floorBuffer.current.push(sRms);
      if (floorBuffer.current.length > 100) floorBuffer.current.shift();
      const avg = floorBuffer.current.reduce((a, b) => a + b, 0) / Math.max(floorBuffer.current.length, 1);
      adaptiveFloor.current = Math.max(avg * 1.5, 0.00015); // Stricter noise wall

      // 1. RUN AI DURING CALIBRATION TO FIND THE "NOISE SCORE"
      const now = Date.now();
      if (now - lastInferenceTime.current > 300 && model && waveform) {
        lastInferenceTime.current = now;
        try {
          const result = await model.run([waveform.buffer]);
          const first = result?.[0];
          const outputData = first instanceof ArrayBuffer ? new Float32Array(first) : (ArrayBuffer.isView(first) ? first as Float32Array : null);

          if (outputData) {
            const scores = Array.from(outputData);
            const coreMax = Math.max(...scores.slice(50, 161));
            const detailMax = scores[494] || 0;

            // Surgical Noise Tracking
            coreNoiseFloor.current = (coreNoiseFloor.current * 0.9) + (coreMax * 0.1);
            detailNoiseFloor.current = (detailNoiseFloor.current * 0.9) + (detailMax * 0.1);

            dynamicAiThresholdRef.current = Math.max(coreNoiseFloor.current + 0.08, 0.20);
            detailThresholdRef.current = Math.max(detailNoiseFloor.current + 0.12, 0.40);
          }
        } catch (e) { }
      }

      if (Math.random() > 0.98) {
        console.log(`[CALIBRATION] Noise: ${avg.toFixed(6)} | AI Floor: ${aiNoiseFloor.current.toFixed(2)} | Threshold: ${dynamicAiThresholdRef.current.toFixed(2)}`);
      }
      return;
    }

    if (!isReadyLogSent.current) {
      console.log('------------------------------------');
      console.log('[ENGINE] CALIBRATION COMPLETE. LISTENING...');
      console.log('------------------------------------');
      isReadyLogSent.current = true;
      floorBuffer.current = [];
    }

    const now = Date.now();

    // 2. HYBRID GATE: Only run AI if volume passes threshold
    if (sRms < adaptiveFloor.current * 0.5) return;

    // 2. THE BRAIN: Run TFLite Inference
    if (now - lastInferenceTime.current > 300) {

      if (model && waveform && !isInferenceRunning.current) {
        try {
          lastInferenceTime.current = now;
          isInferenceRunning.current = true;

          const inputMeta = model.inputs[0];
          // On this device, we MUST pass the raw buffer
          const result = await model.run([waveform.buffer]);

          if (!result || !Array.isArray(result) || result.length === 0) return;

          // Unwrap the ArrayBuffer result (proven to work in Deep Scan)
          const first = result[0];
          let outputData: Float32Array | null = null;

          if (first instanceof ArrayBuffer) {
            outputData = new Float32Array(first);
          } else if (ArrayBuffer.isView(first)) {
            outputData = first as Float32Array;
          }

          if (outputData && outputData.length > 0) {
            const scores: { idx: number, score: number }[] = [];
            for (let i = 0; i < outputData.length; i++) {
              scores.push({ idx: i, score: outputData[i] });
            }
            const top3 = scores.sort((a, b) => b.score - a.score).slice(0, 3);
            if (top3.length > 0) {
              console.log(`[AI] Top: ${JSON.stringify(top3.map(s => `${s.idx}:${(s.score * 100).toFixed(0)}%`))}`);
              confidenceRef.current = top3[0].score;
              topIndexRef.current = top3[0].idx;
            }
          }
        } catch (err) {
          console.error('[TFLITE] Inference failed:', err);
        } finally {
          isInferenceRunning.current = false;
        }
      }
    }

    // 1. NOISE REJECTION FILTERS (AI + DSP)
    const topIdx = topIndexRef.current;
    const score = confidenceRef.current;

    // Reliability Gating:
    // Cluster A: Strict Human Breath (67=Snore, 68=Breathe, 69=Wheeze, 70=Sniff, 103=Sigh)
    // Cluster B (494): Breath Detail Cluster.
    const isBreathCore = (topIdx >= 67 && topIdx <= 70) || topIdx === 103;
    const isBreathDetail = (topIdx === 494);

    const isAiConfidentCore = isBreathCore && score > dynamicAiThresholdRef.current;
    const isAiConfidentDetail = isBreathDetail && score > detailThresholdRef.current;

    // MASTER KEY: If AI is sure (>0.85), we trust it but still need volume
    const hasMasterKey = (isBreathCore || isBreathDetail) && score > 0.85 && sRms > 0.001;

    // HARD SILENCE WALL: Kills ghosts when phone is far away
    const passesHardWall = sRms > 0.0006;

    // 2. DIFFERENTIAL DETECTION (Ultra-sensitive trend)
    const lastRms = floorBuffer.current.length > 0 ? floorBuffer.current[floorBuffer.current.length - 1] : sRms;
    const isRising = sRms > adaptiveFloor.current && sRms > lastRms * 1.02;
    floorBuffer.current.push(sRms);
    if (floorBuffer.current.length > 10) floorBuffer.current.shift();

    const isStrongVolumeSpike = sRms > adaptiveFloor.current * 2.0 && isRising;

    const isHumanBreathStart = passesHardWall && zcr < 0.95 && (
      hasMasterKey ||
      isAiConfidentCore ||
      (isAiConfidentCore && isRising) || // Momentum for humans
      (isAiConfidentDetail && sRms > adaptiveFloor.current * 2.0) || // Volume wall for 494
      (isStrongVolumeSpike && (isBreathCore || isBreathDetail) && score >= 0.25) // Fallback for strong volume (requires 25% conf)
    );

    const isHumanBreathSustain = zcr < 0.95 && (isAiConfidentCore || isAiConfidentDetail);
    const isAiSilence = topIdx === 0 && score > 0.70;

    // 3. CORE STATE MACHINE (Silence -> Inhale -> Exhale)
    const activePhase = phaseRef.current;
    let nextPhase = activePhase;

    if (activePhase === 'Silence') {
      if (sRms > adaptiveFloor.current * 1.05 && isHumanBreathStart) {
        dropCounter.current++;
        if (dropCounter.current >= 1) { // Instant trigger
          nextPhase = 'Inhale';
          dropCounter.current = 0;
          peakRms.current = sRms;
          console.log('[ENGINE] >>> INHALE');
        }
      } else {
        dropCounter.current = 0;
      }
    } else if (activePhase === 'Inhale') {
      if (sRms > peakRms.current) peakRms.current = sRms;

      const inhaleDuration = Date.now() - lastPhaseStartTime.current;

      // EXHALE TRIGGER: Volume drop OR AI detected silence
      // Require 800ms minimum inhale to ensure the UI ring beautifully expands without twitching
      if (inhaleDuration > 800 && (sRms < peakRms.current * 0.75 || sRms < adaptiveFloor.current * 1.3 || isAiSilence)) {
        dropCounter.current++;
        if (dropCounter.current >= 2) {
          nextPhase = 'Exhale';
          console.log('[ENGINE] <<< EXHALE');
          dropCounter.current = 0;
        }
      } else {
        dropCounter.current = 0;
      }
    } else if (activePhase === 'Exhale') {
      const exhaleDuration = Date.now() - lastPhaseStartTime.current;
      const isExhaleComplete = exhaleDuration > lastInhaleDuration.current * 0.8;

      if ((sRms < adaptiveFloor.current * 1.5 || sRms < peakRms.current * 0.4 || isAiSilence) && isExhaleComplete) {
        nextPhase = 'Silence';
        console.log('[ENGINE] --- PAUSE');
      } else if (isRising && sRms > adaptiveFloor.current * 1.5 && exhaleDuration > 1000 && isHumanBreathStart) {
        nextPhase = 'Inhale';
        console.log('[ENGINE] >>> RE-INHALE');
      }
    }

    // 3. SMART SEARCH: If in long silence, aggressively lower floor to find the user
    const silenceDuration = Date.now() - lastPhaseStartTime.current;
    if (activePhase === 'Silence' && silenceDuration > 6000 && Math.random() > 0.9) {
      adaptiveFloor.current = Math.max(adaptiveFloor.current * 0.9, 0.00005);
    }

    if (nextPhase !== activePhase) {
      const nowTime = Date.now();
      const duration = nowTime - lastPhaseStartTime.current;

      // SYNC IMMEDIATELY to prevent duplicate logs in fast callbacks
      phaseRef.current = nextPhase;
      setCurrentPhase(nextPhase);
      lastPhaseStartTime.current = nowTime;

      if (activePhase === 'Inhale') {
        accumulatedInhaleTime.current += duration;
        lastInhaleDuration.current = accumulatedInhaleTime.current;
      } else if (activePhase === 'Exhale') {
        const activeDuration = lastInhaleDuration.current + duration;
        accumulatedInhaleTime.current = 0; // Reset after successful cycle

        if (activeDuration > 1000) {
          const currentCycleStart = now - activeDuration;

          // Accurate BPM: Time since LAST inhale started
          let cycleToUse = cycleTimestamps.current.length > 0
            ? (currentCycleStart - cycleTimestamps.current[cycleTimestamps.current.length - 1])
            : activeDuration * 2.5;

          // SAFETY: Full cycle must be at least as long as the breath itself
          if (cycleToUse < activeDuration) cycleToUse = activeDuration + 500;

          // NOISE FILTER: Ignore unrealistically fast cycles (< 2s)
          if (cycleToUse > 2000) {
            cycleDurations.current.push(activeDuration);
            const bpm = Math.min(60000 / cycleToUse, 40);
            const { variance } = calculateMetrics();
            const ieRatio = lastInhaleDuration.current / duration;
            const depth = Math.min(peakRms.current / 0.1, 1.0);

            setMetrics({ bpm, variance, ieRatio, depth });
            updateState(bpm, variance, ieRatio);
          }
        }
      } else if (activePhase === 'Silence') {
        // Adapt noise floor conservatively during silence
        const silenceAvg = sRms;
        // Only raise floor if it's consistently quiet to avoid swallowing shallow breaths
        if (silenceAvg > adaptiveFloor.current) {
          adaptiveFloor.current = (adaptiveFloor.current * 0.995) + (silenceAvg * 1.1 * 0.005);
        } else {
          adaptiveFloor.current = (adaptiveFloor.current * 0.9) + (silenceAvg * 1.1 * 0.1);
        }
      }

      // SAFETY: If stuck in Exhale for > 12s, something is wrong
      if (activePhase === 'Exhale' && duration > 12000) {
        console.log('[ENGINE] ! SAFETY RESET: Phase Exhale too long. Force Silence.');
        nextPhase = 'Silence';
        // Still give credit for the long breath before resetting
        const { bpm, variance } = calculateMetrics();
        const ieRatio = lastInhaleDuration.current / duration;
        setMetrics(prev => ({ ...prev, bpm, variance, ieRatio }));
        updateState(bpm, variance, ieRatio);
      }

      // SAFETY HEARTBEAT: If a breath phase is unrealistically long, force a reset
      if (duration > 30000 && (activePhase === 'Inhale')) {
        console.log(`[ENGINE] ! SAFETY RESET: Phase ${activePhase} too long. Force Silence.`);
        nextPhase = 'Silence';
        adaptiveFloor.current *= 0.8; // Increase sensitivity
      }

      setCurrentPhase(nextPhase);
      lastPhaseStartTime.current = now;
      if (nextPhase === 'Inhale') peakRms.current = sRms;
    } else if (nextPhase === 'Inhale') {
      peakRms.current = Math.max(peakRms.current, sRms);
    }
  }, [model, isCalibration, currentPhase, calculateMetrics]);

  // State Stability & Awareness Monitor
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const timeInTarget = now - stateStartTime.current;

      // 45s AUTO-RESET: If no breath detected for 45s, return to initial phase
      const isAlreadyAtStart = state === MindscapeState.TRANSITION && metrics.bpm === 0;
      if (!isCalibration && !isAlreadyAtStart && currentPhase === 'Silence' && now - lastPhaseStartTime.current > 45000) {
        console.log('[ENGINE] 45s Inactivity -> Auto-Reset');
        reset();
        return;
      }

      // Strict Hold Durations: Require ~2 consistent breaths for high-calm states
      const holdRequired: Record<MindscapeState, number> = {
        [MindscapeState.NARROWED]: 5000,
        [MindscapeState.TRANSITION]: 8000,
        [MindscapeState.EXPANDED]: 12000,
        [MindscapeState.STABILISED]: 12000,
      };

      if (targetState.current !== state && timeInTarget >= holdRequired[targetState.current]) {
        // Transition Bridge Rule: No skipping states (prevents sudden Narrowed jumps)
        const states = [MindscapeState.NARROWED, MindscapeState.TRANSITION, MindscapeState.EXPANDED, MindscapeState.STABILISED];
        const currIdx = states.indexOf(state);
        const targetIdx = states.indexOf(targetState.current);

        if (Math.abs(currIdx - targetIdx) > 1) {
          const step = targetIdx > currIdx ? 1 : -1;
          const nextStep = states[currIdx + step];
          console.log(`[ENGINE] State Transition Bridge: ${state} -> ${nextStep}`);
          setState(nextStep);
          stateStartTime.current = now; // Reset timer for the next step
        } else {
          console.log(`[ENGINE] State Confirmed: ${targetState.current}`);
          setState(targetState.current);
        }

        // Awareness Moment Check (after 45s)
        if (now - sessionStartTime.current > 45000 && !hasTriggeredAwareness.current) {
          setIsAwarenessMoment(true);
          hasTriggeredAwareness.current = true;
          setTimeout(() => setIsAwarenessMoment(false), 3000);
        }
      }
    }, 200); // Faster polling (200ms)

    return () => clearInterval(timer);
  }, [state]);

  const reset = () => {
    setState(MindscapeState.TRANSITION);
    setMetrics({ bpm: 0, variance: 0, ieRatio: 1, depth: 0 });
    cycleTimestamps.current = [];
    cycleDurations.current = [];
    sessionStartTime.current = Date.now();
    lastPhaseStartTime.current = Date.now(); // MUST RESET THIS TOO
    accumulatedInhaleTime.current = 0;
    hasTriggeredAwareness.current = false;
    setIsAwarenessMoment(false);
  };

  return {
    state,
    metrics,
    currentPhase,
    handleInference,
    isAwarenessMoment,
    reset
  };
};
